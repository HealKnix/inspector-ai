# Методика приёмки ACC-method

Версия `ACC-method-2026-09-27.1`. Здесь зафиксированы разрешённые входы, внешний формат, формулы и проверки первого этапа. Это не заключение о качестве приложения и не результат hidden test.

- [Реестр требований](requirements.json): C01–C24, все шесть High, отдельные H/F, владельцы и воспроизводимые критерии. `NOT_RUN` означает, что соответствующая приёмка продукта ещё не выполнена.
- [Происхождение, роли и object split](inputs.md), [машинное разбиение](development-split.json), [инвентаризация публичного пакета](contracts/input-inventory.json) и [203 проверенных оригинала](contracts/public-file-integrity.json).
- [Контракт для EXPORT](submission.md), точная [схема организатора](contracts/submission_schema.json), синтетические [валидный](fixtures/submission-valid.synthetic.json) и [невалидный](fixtures/submission-invalid.synthetic.json) примеры.
- [Формулы и контрольные значения](metrics.md); [стенд, таймеры и нерешённые вопросы](performance.md).
- [Первичные источники и их SHA-256](sources.json). Исходные документы объектов, полная предразметка и скрытые ответы в репозиторий не скопированы.

Команды из корня `inspector-ai`, после обычной установки закреплённых зависимостей проекта:

```powershell
node scripts/acceptance/check-method.mjs
node node_modules/vitest/vitest.mjs run --config scripts/acceptance/vitest.config.mjs
node scripts/acceptance/submission.mjs docs/acceptance/fixtures/submission-valid.synthetic.json
node scripts/acceptance/submission.mjs docs/acceptance/fixtures/submission-invalid.synthetic.json
```

Последняя команда намеренно завершается с кодом 1. Валидатор использует закреплённый в `backend` пакет `ajv` 8.20.0, тесты — существующий Vitest. Ajv перенесён в runtime dependencies для обязательного gate MAT; версия не менялась. Никаких запросов к сети или БД эти проверки не делают.

Для повторного исследования выданных публичных материалов передать каталог, в котором лежат три исходные папки. Скрипты используют фиксированный allowlist, не обходят каталоги организатора и не открывают hidden документы/метки:

```powershell
node scripts/acceptance/inventory.mjs <materials-root> .test-output/acceptance/inventory
node scripts/acceptance/verify-public-files.mjs <materials-root> .test-output/acceptance/public-file-integrity.json
```

`inventory` независимо хеширует контракты/публичные индексы, проверяет object split и коллизии, сверяет архив и checksums. `verify-public-files` читает байты только 203 `TRAIN_PUBLIC` оригиналов. Для текущего комплекта проверены все 1 749 666 950 байт: 203/203 SHA-256 совпали. Последующий прогон сохранять отдельно и сравнивать хеши; изменение источника требует новой версии методики/набора, а не замены старого evidence.

Методика не требует доступа приложения к ответам оценщика. Следующие этапы ACC остаются открытыми: фактический baseline модели, независимое качество, exporter-output, нагрузка, UX, промышленная эксплуатация и финальный offline release.
