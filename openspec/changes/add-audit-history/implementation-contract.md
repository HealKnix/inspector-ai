# AUD-initial — контракт реализованного основания

Срез 27.09.2026. Основание — gate `AUD-initial` из `openspec/release-plan.json`.
Это чтение существующей истории и порт producers; полный C21 остаётся открытым.

## Запись и совместимость

`writeAuditEvent(tx, args)` вызывается внутри **транзакции владельца операции**.
Функция не создаёт отдельную транзакцию, не меняет бизнес-статус и не выдаёт
полномочия. Используется существующая `AuditEvent`: автор, объект, action,
requestId, IP, серверное время и details. В details добавляется `_audit` версии 1:
correlation_id, actor_kind, user_agent. HTTP request_id генерирует сервер;
пользователь берётся из JWT/session guard. Идемпотентные бизнес-ключи остаются
в прежних receipts/details и не заменяются correlation.

Для фонового PAR сохранённый `userId` означает существующую связь с загрузившим
пользователем, а actor.kind=service и actor.user_id=null не выдают работу
worker за новое действие инспектора. Старым записям metadata не дописываются.
У старого события без `_audit` correlation/user_agent возвращаются null,
metadata_recorded=false. Значение user-agent ограничено 256 символами;
управляющие символы и признаки секретов отбрасываются.

## Чтение

`GET /api/v1/objects/{objectId}/audit-events?limit=50&cursor=…&protocol_id=…`

- Существующий ObjectAccess: только назначенный INSPECTOR; ADMINISTRATOR,
  неназначенный инспектор и пользователь с отозванным назначением получают отказ.
- limit: 1–100. Сортировка created_at DESC, event_id DESC. Курсор содержит
  границу страницы и область object/protocol; перенос курсора в другой фильтр
  отклоняется. Новые события читаются после обновления первой страницы.
- protocol_id проверяется в том же объекте; история выбирает сохранённую версию,
  а не подставляет текущий протокол. Доступ и запрос выполняются под существующей
  блокировкой объекта в одной транзакции.
- Ответ: schema_version, object_id, protocol_id, items, next_cursor. Событие
  содержит event_id/action/occurred_at/request_id/correlation_id/actor,
  ip_address/user_agent, metadata_recorded, безопасные details и decision|null.
  Для отмены финализации отдельно возвращается сохранённая reason.
- `details` — allowlist технических идентификаторов, версий, кодов и hashes.
  Неизвестный JSON не отдаётся целиком. Пароли, токены, base64, полный текст и
  произвольные вложенные объекты не попадают в проекцию.
- Для finding.decision оригинал решения читается через существующий receipt:
  object + request + actor + finding. Возвращаются его ID, автор, время,
  переход, reason_code и сохранённый комментарий. Отсутствующий receipt не
  восстанавливается по текущему состоянию находки: decision=null.

Проекция аддитивная, без переписывания истории. Используется существующий индекс
`audit_events(object_id, created_at)`; новую таблицу/миграцию этот этап не вводит.
Полный UI, межобъектный поиск, выгрузка и расширенная матрица доступа — позже.

## Матрица покрытия существующих producers

У каждой строки уже есть серверное время, userId/requestId; HTTP получает IP и
user-agent через контекст. «Ссылка на основание» не означает копирование исходника
в аудит.

| Сценарий и действие                                                                            | Владелец/транзакция                           | Основание, версии                                                                           | Что остаётся открытым                                                                           |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Объект: object.created, object.access.granted/revoked                                          | ObjectsService / ObjectAccessService          | object_id, initial/target user_id                                                           | Общий административный журнал                                                                   |
| Загрузка: documents.admission                                                                  | DocumentAdmissionService                      | process/run, client_upload_id, accepted/rejected/duplicates, reason_codes                   | Функции приёма не переизобретены; отказ до регистрации пакета остаётся технической ошибкой HTTP |
| PAR retry: parsing.retry.requested                                                             | ParsingService                                | file/run/task/cycle, retry_request_id; receipt предотвращает второй цикл                    | Полный каталог операторских событий/инцидентов                                                  |
| PAR исход: parsing.succeeded/failed                                                            | ParsingJobsService                            | file/run/process/task/cycle/attempt, error_code; actor=parsing-worker                       | Политика хранения/централизованная доставка                                                     |
| ID retry/resolution                                                                            | ClassificationService / IdentificationService | file/artifact/task/retry request; process/previous_run/run/document_ids/resolved_input_hash | UI полной истории уточнений и новые операции ID                                                 |
| COM: expected_package.generated/confirmed, completeness.evaluated                              | CompletenessService                           | существующие package/result/run/hash-ссылки                                                 | Дальнейшее расширение allowlist по контрактам producers                                         |
| VER: protocol.generated, finding.decision, protocol.finalized, protocol.finalization_cancelled | VerificationService                           | protocol/version/run/hash; decision receipt + сохранённый комментарий; причина отмены       | Evidence CRUD/split и полный UI ещё не реализованы своим владельцем                             |
| MAT: существующие изменения правила, passport/regression                                       | MatrixAdminService / MatrixReviewService      | rule/passport/report IDs и hashes                                                           | Межобъектный административный доступ в AUD не открыт; приёмка MAT у владельца                   |
| Будущие evidence/split/export/exchange/HYP/GOLD/ML                                             | Владельцы новых операций                      | Передают собственные actor/reason/version и безопасные ссылки через тот же helper           | События не фабрикуются; подключение и тесты остаются открытыми                                  |

CLI-импорт и административные команды, не использующие HTTP, не получают
выдуманные IP/user-agent. Их существующие события сохраняются. Полное покрытие
входа/выхода, защищённого чтения, отказов и новых producers остаётся в полном
каталоге C21; `AUD-initial` этого не обещает.

## Проверка первого этапа

В `backend/test/observability-audit.test.ts`: реальный PostgreSQL, отдельная БД;
чтение новых и старых событий, scope/revoke/роль, курсор при параллельном
добавлении, откат бизнес-изменения при отказе записи аудита, историческое решение
при наличии новой версии, реальный retry без второго эффекта. Старые записи и
решения сравниваются до/после; JSON-контракт проверяется unit-тестами.
Миграция копии существующей эксплуатационной БД в этом этапе не выполнялась:
DDL AUD не менялся. Это ограничение не маскируется отметкой полной задачи 1.4.
