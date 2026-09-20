# Доказательства реализации add-document-completeness

Дата: 2026-09-20. Ветка `feat/document-completeness`, worktree
`inspector-ai-completeness`, изолированный стек `inspector-com`
(postgres:5434, rabbitmq:5674, frontend:8084, backend:3010).

## Команды и результаты

### Миграции и каркас (2.1, 2.2)

```text
bunx prisma migrate deploy
  → 20260920135149_document_completeness, 20260920142000_framework_source_fields,
    20260920180000_package_confirm_receipts — applied

bun run framework:import / framework:approve
  → {"v":1,"status":"approved","approvedBy":"com_admin",
     "counts":{"vocabularies":84,"requirements":38,"mappings":52}}
```

Источник каркаса: `docs/requirements/10. Мосстройнадзор.pdf` §3–6,
SHA-256 `ceada88f…8513` зафиксирован в `framework_sets.source_sha256`
и `backend/scripts/framework-v1.jsonl` meta-строке.

### Unit-тесты

```text
backend  vitest run        → 254 passed (16 files)
  completeness: engine 13, openapi-схемы 6, framework-source 6
frontend vitest run        → 172 passed (26 files)
  completeness: endpoints 9, CompletenessPanel 4
```

### Сквозная проверка сервиса (5.2, 5.3)

`bun run completeness:verify` — реальный Prisma/Nest-контекст на живой БД;
объект, run и файлы создаются строками БД, результат классификации —
в реальном формате `ClassificationResult` слоя ID (контент синтетический,
явно обозначен `method: "rules"`, `versions.*: "verify"`):

```text
evaluate без подтверждённого перечня   → ConflictException
generate(атрибуты + перечень hidden_works) → proposed v1, 24 требования
evaluate по proposed-версии            → ConflictException
confirm(expected_version=99)           → ConflictException (контроль версии)
confirm(expected_version=1, basis)     → confirmed v2
confirm повтор с тем же request_id     → та же v2, версий всего 2 (идемпотентно)
evaluate(run)                          → PARTIALLY_LOADED,
  counts {applicable:24, fulfilled:1, missing:6, unverifiable:17, na:0}
evaluate повторно                      → новая строка completeness_results,
  результата 2, вывод детерминирован (тождественные evaluation)
getPackage чужим инспектором           → ForbiddenException
```

Расшифровка исходов на снимке «1 ПД-файл (вид не разрешён) + 1 АОСР +
1 исполнительная схема»:

- `RD-PDOC:fulfilled` — `quantity.min=0`, требование «при наличии».
- `ID-AOSR#устройство свай:unverifiable` — акт найден по виду, область
  работ текущим слоем ID не идентифицирована → ни исполнено, ни пропуск.
- `ID-*` прочие:unverifiable — «Исполнительная схема» разрешается в три
  кода словаря → `kind_ambiguous` → уточнение, а не missing.
- `PD-*:unverifiable` — классификатор пока не выдаёт коды разделов ПД
  (document_kind=null) → `kind_unresolved`, пропуск не фиксируется.
- `RD-*:missing` — файлов стадии РД в снимке нет вообще.

## Ограничения и честные границы

- Сопоставление только по стадии и виду документа: сущности
  Document/Revision/FileDocumentPart и GEO-результаты отсутствуют —
  требования к редакциям, листам и областям уходят в `unverifiable`.
- Коды разделов ПД/РД из классификатора не поступают → требования ПД/РД
  массово `unverifiable` до доработки слоя ID (контракт C-ID).
- Извлечение объектных перечней — якорная эвристика §5 ТЗ; артефакты
  без текстового слоя дают пустой список кандидатов (не ошибку).
- Отображение `document_kind` → `kind_code` словаря задано явной таблицей
  для трёх видов ИД, которые умеет выдавать классификатор.
- Полный прогон реального пайплайна (parser + workers + загрузка файлов)
  не выполнялся: стек парсера/воркеров в этой сессии не поднимался;
  проверка 5.1 на боевых выходах ID/EXT/GEO остаётся открытой.
- Транспортное событие `expected-composition.confirmed` пишется в outbox
  (очередь `inspector.events`); потребителя у события пока нет — оно
  нужно INC для инкрементального пересчёта.

## Отложенные обязательства (не закрыты этим change)

- C24: итоговый протокол и общая приёмка — вне области COM.
- Интеграция INC: вызов `evaluate` доступен как чистая функция и сервис,
  но автоматический пересчёт по событию не подключён.
- Матрица → параметры: `parameterGate` реализован в движке, связка
  с параметрами правил — задача слоя сравнения (CMP).
