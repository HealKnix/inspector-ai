# AUD-initial — свидетельства первого этапа

Дата: 27.09.2026. Проверялось рабочее дерево на базе
`15adb5e3ce3a42aa97c3ed5fab9573ae192e095a`, включая незакоммиченные изменения
первого этапа. Это не идентификатор собранного релизного артефакта.
Реализованный контракт: [implementation-contract.md](implementation-contract.md).

## Выполненные проверки

Команды выполнялись из `backend`, если не указано иное; Node v24.16.0.

| Команда                                                                                                                                                                                                                                             | Результат и смысл                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `node ../node_modules/typescript/bin/tsc --noEmit --pretty false`                                                                                                                                                                                   | exit 0 после последних правок runtime                                                                                                 |
| `node ../node_modules/vitest/vitest.mjs run --maxWorkers 2`                                                                                                                                                                                         | 31 файл, 462 теста пройдено; unit-набор текущего backend, включая 6 новых проверок observability/audit                                |
| `node ../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/verification.test.ts test/parsing.test.ts test/observability-audit.test.ts`                                                                                  | 3 файла, 33 теста пройдено, 75.82 с; завершение 27.09.2026 около 00:07 UTC                                                            |
| `node ../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/observability-audit.test.ts`                                                                                                                                 | 7 тестов пройдено, 43.74 с; повтор после усиления assertions для фактического прироста метрик, очереди и correlation, около 00:14 UTC |
| `node ../node_modules/eslint/bin/eslint.js src/infrastructure/audit src/infrastructure/observability src/config/environment.ts src/config/environment.test.ts test/observability-audit.test.ts src/modules/documents/document-admission.service.ts` | exit 0                                                                                                                                |
| `git diff --check -- backend/src/infrastructure backend/src/config backend/test/observability-audit.test.ts backend/document-parser/server.py` из корня                                                                                             | exit 0                                                                                                                                |
| `openspec validate add-audit-history --strict` из корня                                                                                                                                                                                             | change valid; в полном change отмечены 3/17 задач, частичные задачи остаются открытыми                                                |

`observability-audit.test.ts` использует отдельную случайно названную БД
`audit_obs_*` на тестовом PostgreSQL, отдельный RabbitMQ vhost и отдельный
Python-контейнер. Рабочие базы не сбрасывались. Синтетические fixtures содержат
старый AuditEvent без `_audit`, существующий receipt решения и две версии
протокола. Сами старые записи/решения сравниваются до и после чтения.

Проверены безопасная проекция, неизвестные старые metadata, scope объекта и
версии, отказ чужому инспектору/администратору, отзыв назначения, keyset cursor
при новом событии, откат предметного изменения при FK-отказе аудита и retry
без второго предметного эффекта. История старого решения выбирается через
receipt, даже когда существует новая версия протокола.

## Границы результата

AUD не добавляет DDL: проекция использует существующую таблицу и индекс.
Миграция копии эксплуатационной БД не проводилась; полная задача 1.4 открыта.
Будущие evidence/split/export/exchange producers имеют общий порт, но их
операции этим change не реализованы. UI истории, межобъектные полномочия,
diff/export, защита БД от UPDATE/DELETE, checkpoints и архив остаются открытыми.
Не проверялись полная ротация/retention и восстановление промышленного архива.

Готовность `AUD-initial` подтверждает безопасное чтение существующей истории и
транзакционный порт записи; она не завершает change `add-audit-history`.
