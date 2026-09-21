# Доказательства готовности: add-inspector-verification

Работа велась в worktree `inspector-ai` на ветке `feat/inspector-verification`,
созданной от `feature/document-upload-backend-wiring` с merge
`feat/comparison-completeness` (коммит `4960bb0`) — ветка содержит сверку по
матрице и gate комплектности.

## Проверки

- `bun run typecheck` (backend) — чисто (Prisma Client 7.10.0, generate в
  pipeline).
- `bun run build` (backend, nest build) — успешно.
- `bun run test` (backend unit) — 18 файлов, 300 тестов, все зелёные, включая
  `protocol-builder.test.ts` (26 тестов: маппинг вердиктов, gate, fingerprint,
  findings_hash, контент).
- `bunx vitest run --config vitest.integration.config.ts
  test/verification.test.ts` — 6/6 сценариев на одноразовом стеке
  (PostgreSQL :25432, RabbitMQ :25672, HTTP-приложение :3302), ~16 с.
- eslint по изменённым файлам — 0 ошибок; prettier — применён.
- Миграция `20260921001514_inspector_verification` применена к dev-БД
  (`prisma migrate dev`): enum'ы `finding_status`, `protocol_status`,
  `decision_action`; таблицы `protocols`, `findings`, `finding_decisions`,
  `finding_decision_receipts`. Аддитивная, существующие строки не затронуты.

## Интеграционные сценарии (test/verification.test.ts)

| Сценарий | Проверено |
| --- | --- |
| Генерация протокола | findings из 132-строковой матрицы: discrepancy→CANDIDATE (P001, P003), match→NEGATIVE_VERIFIED (P002), actual_missing→MISSING_EVIDENCE (P005), параметр без правила→MISSING_EVIDENCE (P004); процесс → READY; outbox `protocol.generated`; audit `protocol.generated` |
| Идемпотентность генерации | повтор при неизменном `findings_hash` → та же версия, `reused: true`, без новых строк |
| Доступ и запреты | инспектор без назначения → 403; generate при PARSING → 409 |
| Полный цикл | решения confirm/reject → VERIFYING → COMPLETED → finalize → FINALIZED; отмена финализации администратором → COMPLETED, протокол снова active; отмена инспектором → 403 |
| Идемпотентность решения | повтор `request_id` → записанное решение без дубликата (`replayed: true`) |
| Перенос решений | регенерация: неизменный fingerprint → решение перенесено (статус, decidedBy, история); изменённый fingerprint → находка сброшена в CANDIDATE |

## Подтверждённые свойства

- Явный триггер: протокол создаётся только по `POST .../protocol/generate`,
  из сохранённых `evidence_groups.verdict` — предварительный вердикт не
  становится решением автоматически.
- Gate комплектности исполняется до вердикта: `parameterGate` из
  completeness-engine отклоняет находки при отсутствии доказательств,
  незавершённых задачах и неприменимости.
- Оптимистическая блокировка: `finding_version` (row_version) при расхождении
  → 409 с актуальной версией в сообщении.
- Транзакционность: все мутации под `pg_advisory_xact_lock` по объекту,
  audit + outbox в той же транзакции.
- Иммутабельность версий: регенерация создаёт новую версию, прежняя →
  `superseded`; решения переносятся копией с сохранением истории
  `finding_decisions`.

## Ограничения среза

- Живой прогон на «Новослободской» (generate → decision по P022 → finalize на
  реальных 6 PDF) не выполнялся — локальный стек содержит старые образы без
  comparison-кода; интеграционный стек покрывает тот же контур на синтетических
  данных.
- Отмена финализации доступна только ADMINISTRATOR (в enum `Role` нет роли
  супервизора) — зафиксировано в design.md (D9).
- `scope_key` пуст: находка атомарна по параметру объекта, разнесение по
  корпусам/секциям — следующий срез.
- Шифр/редакция документа в карточке находки отдаются только если ID-слой их
  записал; поля допускают null.
- PDF-экспорт протокола и интеграция с «РиН» — отдельные срезы (C20/C12).
- Frontend не изменялся: страница верификации остаётся моковой
  (`isSynthetic`), подключение к API — следующий срез.
