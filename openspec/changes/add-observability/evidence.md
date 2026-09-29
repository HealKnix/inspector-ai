# OBS-initial — свидетельства первого этапа

Дата: 27.09.2026. Рабочее дерево на базе
`15adb5e3ce3a42aa97c3ed5fab9573ae192e095a` с незакоммиченными изменениями этапа.
Последняя правка runtime AUD/OBS: 27.09.2026 00:02:57 UTC; после неё выполнены
typecheck и объединённые integration tests. Словарь и ограничения:
[implementation-contract.md](implementation-contract.md).

## Выполненные проверки

Из `backend`, Node v24.16.0:

| Команда                                                                                                                                                                                                                                             | Результат                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `node ../node_modules/typescript/bin/tsc --noEmit --pretty false`                                                                                                                                                                                   | exit 0                                                                                                                      |
| `node ../node_modules/vitest/vitest.mjs run --maxWorkers 2`                                                                                                                                                                                         | 31 файл, 462 теста пройдено                                                                                                 |
| `node ../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/verification.test.ts test/parsing.test.ts test/observability-audit.test.ts`                                                                                  | 3 файла, 33 теста пройдено, 75.82 с                                                                                         |
| `node ../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/observability-audit.test.ts`                                                                                                                                 | 7 тестов пройдено, 43.74 с; усиленные assertions metric delta/queue count, correlation и disabled endpoint, около 00:14 UTC |
| `node ../node_modules/eslint/bin/eslint.js src/infrastructure/audit src/infrastructure/observability src/config/environment.ts src/config/environment.test.ts test/observability-audit.test.ts src/modules/documents/document-admission.service.ts` | exit 0                                                                                                                      |

`openspec validate add-observability --strict` из корня: change valid.
В полном change завершены 3/16 задач; частичные задачи оставлены открытыми.

Из корня, Python unittest внутри имеющегося parser image с актуальным кодом,
подмонтированным только для чтения:

```powershell
docker run --rm --network none --mount type=bind,source=D:/Projects/plcb-ds-hach-mik/inspector-ai/backend/document-parser,target=/probe/code,readonly --entrypoint python inspector-document-parser:local -m unittest discover -s /probe/code/tests -p test_observability.py
```

Результат: 2 теста пройдено. Это не сборка финального release image.

## Реальный интеграционный путь

Семь сценариев `observability-audit.test.ts` создают отдельные БД, RabbitMQ
vhost, контейнер и private storage. HTTP retry пишет транзакционный outbox;
dispatcher публикует сообщение в настоящий RabbitMQ, обработчик получает его
через `observeDelivery`, `ParsingJobsService` вызывает ParserClient и настоящий
Python `server.Handler`. Native XML pipeline создаёт изображения и parse artifact.
Один UUID подтверждён в API/outbox/worker/Python логах, входной HTTP UUID не
принимается за серверный, текст XML/токены не обнаружены в диагностике.
Повтор исходного retry не создаёт второй аудит/цикл задачи.

Проверено, что HTTP нагрузка меняет histogram count/duration, actual DB outbox
и session counts и Rabbit ready queue читаются из настоящих источников.
При отключённом источнике присутствует source_up=0, а отсутствующее измерение
не подменяется нулём. Токен метрик обязателен и независим от JWT; отключённый
endpoint возвращает 404, неверный credential — 401. Labels ограничены перечнями.
Unit-тесты проверяют production DEBUG suppression, секреты/ошибки/base64,
конкурентный ALS и отображение существующих notification event names.

Probe заменяет только scheduler Supervisor для доступного native XML входа;
OCR-модели не загружаются. Проверка подтверждает инфраструктурный путь с реальным
парсером, но не качество OCR/H100 и не готовность offline-моделей.

## Что ещё не проверено и не заявлено

Полный recovery с новым outbox вне исходного контекста и fault injection
каналов, consumer/receipts уведомлений, согласованные получатели, email/Telegram,
Python/GPU metrics exporter, Prometheus/Grafana, ELK и retention остаются
открытыми задачами change. Uptime процесса не используется как подтверждение SLA.
Release image/изолированный Compose и его внешняя граница проверяются владельцем
OFF/HARD отдельно; здесь не подменяются результаты их приёмки.

Готовность `OBS-initial` означает безопасный JSON/correlation, реальные базовые
технические измерения и порт уведомлений, а не полный эксплуатационный C23.
