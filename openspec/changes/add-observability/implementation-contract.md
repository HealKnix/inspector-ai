# OBS-initial — логи, корреляция и технические показатели

Срез 27.09.2026. Контракт foundation gate `OBS-initial`; полный C23 не закрыт.

## JSON и передача контекста

Каждая новая диагностическая запись содержит schema_version=1, timestamp,
level, service, message (технический код), request_id, correlation_id, user_id
и actor_kind. Допускаются только явные технические UUID, числовые измерения и
признак исчерпания. Error.message/stack, произвольные JSON-поля, URL, заголовки,
полные тексты, base64 и секреты не сериализуются. Старые вызовы Nest Logger
проходят тот же allowlist; неструктурированное сообщение даёт `runtime.message`.
DEBUG/verbose отключены при NODE_ENV=production.

HTTP получает новый серверный request_id и ответный `X-Request-Id`; входной
HTTP заголовок не может задать серверную идентичность. AsyncLocalStorage
разделяет одновременные запросы; JWT guard добавляет проверенного пользователя.
Вне пользовательского запроса user_id=null.

`writeOutboxEvent(tx,args)` сохраняет `_trace` рядом с предметным JSON в
существующей outbox **в той же транзакции**. Dispatcher извлекает его и удаляет
перед публикацией, передавая `x-request-id`/`x-correlation-id` в AMQP headers и
correlationId. Строгие предметные сообщения остаются прежними. Контекст
сохраняется при повторной доставке уже записанного outbox-события.

API → outbox dispatcher → parsing/classification/extraction workers →
ParserClient → Python используют общий контекст. Queue user_id никогда не
используется для авторизации и не превращает работу worker в действие человека.
Python принимает trace headers только после проверки отдельного PARSER_TOKEN;
при отказе создаёт собственный контекст. Логи Python не включают URL/тело/ошибку
библиотеки; operation ограничен parse/health/progress/cancel/other.

Для старых outbox без metadata используется прежний request_id, если он есть,
иначе event_id. Для новых системных событий без исходного HTTP request также
нет выдуманного пользователя. Полное восстановление исходной корреляции при
создании нового события recovery вне сохранённого контекста остаётся отдельной
сквозной fault-injection проверкой OBS 5.1; run/task IDs не изменяются.

## Измерения и граница доступа

API: `/api/internal/metrics`. Worker: `/metrics` на существующем health port.
Оба требуют **отдельный** `Authorization: Bearer <METRICS_TOKEN>`; JWT/роль
администратора не дают доступ. Без переменной endpoint отвечает 404. Ключ:
32–256 допустимых символов, проверяется при старте; пустое значение отключает
выдачу. Прокси внешнего приложения не должен публиковать `/api/internal/`.
Health не раскрывает метрики или детали документа. Сравнение ключа — constant time.

| Метрика                                                           | Единица/семантика                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| process_cpu_user_seconds_total / process_cpu_system_seconds_total | Накопленные CPU-секунды текущего Node-процесса; доля CPU вычисляется rate, а не выдумывается                   |
| process_resident_memory_bytes / nodejs_heap_size_used_bytes       | Фактические байты памяти Node-процесса                                                                         |
| process_uptime_seconds                                            | Время процесса, **не SLA**                                                                                     |
| inspector_storage_available_bytes / inspector_storage_size_bytes  | Фактический statfs STORAGE_ROOT                                                                                |
| inspector_http_request_duration_seconds_{bucket,sum,count}        | Длительность HTTP; RPS — rate(count), 5xx — status_class=5xx; labels только фиксированный method/status_class  |
| inspector_stage_duration_seconds_{bucket,sum,count}               | Время обработки доставки; stages из фиксированного перечня; возврат handler не означает успешный бизнес-анализ |
| inspector_stage_exceptions_total                                  | Исключения, вышедшие из измеряемого handler; не счётчик всех предметных отказов                                |
| inspector_active_sessions                                         | Существующие неотозванные AuthSession с expiresAt > now                                                        |
| inspector_outbox_pending / inspector_outbox_exhausted             | Реальные недоставленные записи / недоставленные с attempts ≥20                                                 |
| inspector_queue_ready_messages / inspector_queue_consumers        | RabbitMQ checkQueue: готовые сообщения и consumers; ready не включает unacked                                  |
| inspector_metrics_source_up / inspector_queue_source_up           | Успех измерения; недоступный источник не выдаёт фиктивный нулевой показатель                                   |

RabbitMQ labels ограничены пятью известными очередями. Проверка не создаёт
отсутствующую очередь. object_id/user_id/URL/ошибки/содержимое не становятся
labels. Histogram boundaries заданы в секундах и включают +Inf.

Это базовые реальные измерения Node и зависимостей. Полная 2.1, все сервисные/GPU
показатели, Prometheus/Grafana, ELK/retention, dashboards и режимы деградации
остаются открытыми. Python сейчас даёт безопасные HTTP duration/status logs;
полный Python/GPU metrics exporter этим результатом не объявляется готовым.

## Порт уведомлений

`notificationSignal` принимает сохранённый Outbox и выдаёт безопасный envelope:
event_id/type, occurred_at, correlation, object/run/protocol/file IDs и audience.
Используются **фактические** имена: `protocol.generated`, `parsing.failed`,
`file.integrity-failed`, `documents.admission.rejected`. Плановые имена
`protocol.ready`/`parsing.exhausted` не выдаются за реализованные.
`NotificationDeliveryPort` отделяет доставку от анализа; audience не является
адресатом или разрешением. Неизвестное событие не подставляется как известное.

Этап не запускает consumer доставки, не выбирает получателей и не отправляет
email/Telegram. Persisted outbox и broker confirm не считаются уведомлением
пользователя. Настройки адресатов, retries/receipts и реальный канал — задачи 3.x.

## Проверка

`backend/test/observability-audit.test.ts`: отдельные PostgreSQL DB и RabbitMQ
vhost, отдельный Python-контейнер, синтетический XML и private storage. Реальный
HTTP retry записывает outbox, dispatcher публикует его, `ParsingJobsService`
потребляет сообщение, ParserClient вызывает настоящий `server.Handler`, native
XML pipeline создаёт изображения и parse artifact. Проверяется общий correlation
и отсутствие содержимого в логах. У fixture заменён scheduler Supervisor, OCR
модели не используются; это свидетельство инфраструктурного пути, не OCR/H100
качества или производственного offline релиза.

Unit-набор проверяет sanitization, DEBUG, конкурентный контекст, ограниченные
labels, credential boundary и notification mapping; Python unittest проверяет
тот же JSON contract. Команды и фактические исходы находятся в evidence.md.
