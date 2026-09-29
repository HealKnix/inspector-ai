# Completeness implementation contract v1

Закрепляет версии входных и выходных контрактов COM по
[CONTRACTS.md](../../CONTRACTS.md) на момент начала реализации.
Отсутствующие зависимости отмечены явно; их отсутствие сужает сопоставление,
но не блокирует остальные проверки.

## Потребляемые сущности

| Сущность                                      | Владелец | Статус                              | Якорь версии                                                    |
| --------------------------------------------- | -------- | ----------------------------------- | --------------------------------------------------------------- |
| Object / ObjectAccess                         | ING      | есть (`objects`, `object_access`)   | назначение проверяется на каждую операцию                       |
| Process / Run / Job / Outbox / AuditEvent     | C01      | есть                                | `run.version`, `run.input_manifest_hash`                        |
| File / RunInput                               | ING      | есть                                | `file.sha256`, состав Run                                       |
| ParseArtifact                                 | PAR      | есть                                | `pipeline_fingerprint`, `artifact_sha256`                       |
| ClassificationResult                          | ID       | есть частично (слайс классификации) | `result.schema_version = 1`, `classification_tasks.fingerprint` |
| Document / Revision / FileDocumentPart        | ID       | **отсутствует**                     | —                                                               |
| RuleVersion (approved)                        | C05/C18  | есть                                | `rule_versions.id` + `version`                                  |
| Extraction / EvidenceFragment / EvidenceGroup | EXT      | есть                                | `evidence_groups.ruleset_hash`, `extraction.rule_version_id`    |
| GeometryResult                                | GEO      | **отсутствует**                     | —                                                               |
| ResolvedInputSnapshot                         | INC      | **отсутствует**                     | —                                                               |

Пока Document/Revision отсутствуют, документный уровень сопоставления работает
по ClassificationResult (стадия + вид). Требования, которым нужны раздел/марка,
область работ, редакция или разложение файла на части, не помечаются
исполненными и не объявляются отсутствующими — они получают причину
неопределённости и ожидают уточнения (D4, D6).

## Производимые сущности (владелец COM)

| Сущность                                                                | Назначение                                                    | Версия                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------- |
| NormativeFrameworkSet + словари + FrameworkRequirement + SectionMapping | версионированный нормативный каркас, утверждает администратор | `framework_set.version`   |
| PackageVersion + PackageRequirement                                     | ожидаемый состав объекта, подтверждает инспектор              | `package_version.version` |
| CompletenessResult                                                      | результат расчёта по снимку и версии перечня                  | `schema_version = 1`      |

## CompletenessResult v1

Обязательное содержание (строка CONTRACTS.md «CompletenessResult»):
`schema_version`, `object_id`, `process_id`, `run_id`, `package_version`
(версия перечня), `framework_version`, `input_refs` (использованные
`input_manifest_hash` / `ruleset_hash`), постатусный список требований с
причинами и выбранными источниками, агрегаты стадий и сценарий загрузки.
Агрегаты nullable: при неподтверждённом или противоречивом перечне оценка —
явное отсутствие оценки с причиной, без выдуманного знаменателя и без `FULL`.
Пропуск документа — строка результата с причиной, не `finding_status`.

## События

- Публикует: `expected-composition.confirmed` (schema_version 1) — object_id,
  process_id, package_version_id/version, actor. Потребитель — INC.
- Триггерится извне: вызов расчёта для снимка/версии перечня принадлежит INC;
  сам модуль не подписывается на граф INC (D5).
- Доставка — общий outbox C01; новый транспорт не реализуется.

## Доступ и аудит

Операции чтения/подтверждения требуют действительной сессии инспектора и
назначения на объект (`ObjectAccessService.requireAccess` после advisory lock
объекта). Утверждение каркаса — только `ADMINISTRATOR`. Каждое изменение
оставляет `AuditEvent` с `request_id`, автором и `schema_version`; содержимое
документов и секреты в детали и логи не попадают (COM-QA).

## Границы версии 1

- Нет Document/Revision: сопоставление грубее раздела/марки невозможно;
  такие требования честно уходят в уточнение.
- Нет ResolvedInputSnapshot: расчёт принимает текущий Run + явно переданные
  версии; перенос результатов между снимками принадлежит INC.
- Нет GeometryResult: требования, зависящие от геометрии, остаются
  непроверяемыми с явной причиной.
