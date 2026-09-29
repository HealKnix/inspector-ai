# Identification, revision and explicit sheet selection

Implementation scope approved by the owner on 25 September 2026. This extends
the existing classification slice; it does not close all original ID obligations.
The 28 September addendum below extends this baseline with an explicitly reviewed
PDF sheet map and 1:1 replacement. Earlier acceptance records retain their original
scope; this addendum does not claim mixed-PDF or automatic stamp interpretation.

## Scope and decisions

- Whole logical documents, revisions and PDF/XML representations. Mixed bundles,
  visual signature verification and partial replacements outside the explicit
  28 September path remain unsupported and prevent automatic comparison.
- Own XML fields use complete namespace-qualified paths. References and attachment
  metadata never replace the document's own fields. `edition` and `Signed` are
  observed evidence, not inferred project approval.
- Unambiguous deterministic field evidence can be accepted; LLM proposals require
  review. Approval, replacement and effective dates require an inspector's basis
  until a separately validated recognition policy exists.
- Automatic representation matching requires complete matching own identity,
  scope and work period and no conflicting recognized metadata. A missing field
  does not act as a wildcard. Files and original hashes are immutable.
- An ID document selects the approved RD revision applicable to its work period
  using its own reference and confirmed scope. There is no automatic PD fallback.
  Other reference pairs require an explicit supported reference or an inspector's
  selection. Upload time and maximum revision number are not selection rules.
- Missing dates, approval, scope, unsupported parts or conflicting replacements
  remain clarification reasons, never violations or negative verified results.

## Persistence and processing

ID owns Document, DocumentRevision, FileDocumentPart, FieldCandidate and
append-only Clarification. Raw machine evidence remains separate from decisions.
A card version is not an original document revision. The original File and
ParseArtifact are preserved.

The limited INC bridge owns immutable ResolvedInputSnapshot records tied to a
Run and its original InputManifest. They freeze documents, selected revisions,
representations, decisions, policies and comparison contexts. New snapshots never
rewrite old snapshots. A dependency graph and incremental scheduling are deferred.

`Apply and recalculate` atomically checks current Run/card versions, assignment,
process state and active work; saves decisions; creates a new Run on the same
originals; and registers Job/Outbox. The process_id stays stable. Retries use a
request receipt and payload fingerprint. Existing PAR cache is reused through
new current-Run tasks/artifact records, without bypassing fencing.

Application is permitted for assigned inspectors in PENDING, READY, VERIFYING
and COMPLETED when no processing is active. PARSING and FINALIZED reject writes.
Classification retry cannot erase a human decision. The old manual kind endpoint
uses the same clarification service and cannot bypass version/basis validation.

## Consumer boundary

COM counts logical documents instead of formats. EXT/CMP use a pinned snapshot
and comparison context (reference/actual revisions, scope and work period), not
all PD files against all RD/ID files. Unresolved contexts block only dependent
comparisons. Several contexts of one parameter remain separate findings.

Evidence groups are append-only per Run/snapshot/context/content. Findings freeze
members and locators; historical reads do not consult a mutable current group.
Protocol reuse and decision carry-forward require the same complete semantic
basis, including source revisions, rule, scope and evidence. Finalized and old
protocols remain readable. A new Run makes the old protocol historical and requires
explicit protocol generation after processing.

## API and UI

- GET `/api/v1/processes/:processId/documents?run_id=...`
- GET `/api/v1/processes/:processId/documents/:documentId?run_id=...`
- POST `/api/v1/processes/:processId/document-resolutions`, with request_id,
  expected_run_id, expected card versions and a basis for each decision.

Responses include actual Run, snapshot, card versions and allowed actions.
Historical reads are explicit. Evidence always resolves against its exact
artifact/hash. Stale mutation returns 409; an identical replay returns the original
response. The UI keeps process/Run/document in its URL and uses the existing viewer.

## Acceptance and rollout

Owner clarification 2026-09-26: the inspector-facing screen presents a compact,
type-specific card beside the original. Normal comparison source selection is
automatic under the existing policy; only an actionable ambiguity asks for an
inspector decision. Technical identifiers, diagnostics and detailed history do
not occupy the main form. One primary action confirms displayed non-empty values
or applies corrections using the existing clarification transaction. Confirmation
of unchanged values also creates a new Run with its basis and author; it does not
implicitly confirm approval, hidden fields or a reference. No separate no-recompute
review state is introduced. Unsupported-source limitations and permissions remain.

Additive migrations never recalculate historical data. Old manual classifications
without a basis cannot prove approval or replacement. Unrecoverable legacy
evidence is explicitly unavailable; current evidence is not substituted.

Acceptance covers own vs referenced metadata (AOSR 52), two representations of
one act, old revision uploaded last, two work periods selecting different RD
revisions, unsupported/missing/conflicting inputs, optimistic concurrency,
idempotency, stale workers, immutable history, finalized reload, and reuse of OCR
cache. Tests use an isolated PostgreSQL/RabbitMQ environment. Full ID, all 132
rules, visual signatures, general partial-document processing and quantitative C24
acceptance remain open.

## Native revision candidates — 27 September 2026

Task 10.2 extends the existing FieldCandidate with `observed_replaced_sheet`
and optional `IdentificationEvidence.parse_context`. Engine version is
`whole-document-identification-v3`; old evidence without this property remains
readable. Source/artifact hashes and original block/page/bbox/quote are retained,
along with native validity, main-text inclusion, region kind/method and PAR
limitations. The original PAR artifact is not changed.

Candidate discovery is limited to one unambiguous permission table per page,
200 eligible blocks, 600 characters per block, the local quarter-page below its
header and 32 replacement rows. These are implementation limits, not document
format requirements or evidence of completeness. A numeric sheet must lie below
its own header and on the row of an explicit replacement note. Unknown layouts,
ambiguous/invalid/duplicate native text and conflicting headers abstain. The
existing LLM context budgets and XML signature exclusions remain unchanged.

Permission 158-26 yields revision 3 and separate sheet observations 1, 4 and 8.
All remain candidates, never an automatically accepted revision or active sheet
selection. Excluded or structurally uncertain colon-labelled revisions also
remain candidates. `unsupported_partial_replacement` remains a comparison
blocker. Approval, effective dates, whole-document identity and source selection
cannot be inferred from this table. Task 10.1's decisions and task 10.3's partial
selection/history work remain open.

The UI preserves the optional provenance after API decoding, explains structural
limitations and opens the exact evidence. Observed sheets are excluded from the
normal field-confirmation form. See [evidence](evidence.md) and
[diagnostic report](../../../docs/matrix/identification-candidates-2026-09-27.json).

## Явная карта PDF и замена листов 1:1 — партия 28.09.2026

Это согласованная инженерная граница очередной партии реализации, а не правило,
ограничивающее исходное ТЗ. Партия расширяет существующее уточнение назначенного
инспектора для целого логического документа. Она не определяет границы акта,
паспорта и схемы внутри сборного PDF и не принимает утверждение по штампу.
Исходные задачи 3.4/3.8/3.9 и широкие 10.1/10.3 остаются открытыми в части,
не доказанной этой партией. Владелец предметной идентичности, карты и замены — ID;
INC закрепляет снимок, PAR сохраняет оригинал и физические локаторы, EXT использует
разрешённые страницы, COM отдельно определяет комплектность.

### Таблица оснований и ограничений

| Решение                                               | Основание                                                                                                                                                                                                    | Допустимый путь и граница                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Явная карта «обозначение листа → физическая страница» | Итоговое ТЗ §9.1, физическая страница 16 [PDF](../../../docs/requirements/10.%20Мосстройнадзор.pdf#page=16); ID-04/ID-05 [spec](specs/document-identification/spec.md); [design D1 и продолжение](design.md) | Инспектор вручную сопоставляет страницы одного самостоятельного PDF. Номер страницы не выдаётся за обозначение листа; `1`, `01`, `А-1` остаются различными обозначениями. Найденные `observed_replaced_sheet` не заполняют подтверждённую карту.                                                                                                                              |
| Замена только существующих листов 1:1                 | ID-05: незаменённые листы сохраняются; согласованный объём партии 28.09.2026                                                                                                                                 | Отдельная `sheet_replacement`, явный predecessor, точный перечень и основание. Список равен обозначениям карты нового файла и входит в разрешённый состав predecessor с учётом цепочки. Добавление, удаление, перенумерация и неизвестные обозначения не интерпретируются автоматически. 1:1 — предел этой реализации, не нормативное требование ТЗ.                          |
| Полная и частичная замены различаются                 | Существующий контракт целых редакций; ID-05 и подтверждённая цепочка из [design](design.md)                                                                                                                  | `approval.replaces_revision_id` сохраняет полную замену. Он взаимоисключающий с `sheet_replacement` одной редакции. Неизменённые листы частичной цепочки сохраняют прежний источник.                                                                                                                                                                                          |
| Утверждение и период действия — отдельное решение     | ТЗ §9.1; ID-S1/ID-05/ID-06; §5, физическая страница 10 [PDF](../../../docs/requirements/10.%20Мосстройнадзор.pdf#page=10)                                                                                    | Карта и перечень замены не меняют `approval`. Для выбора каждый используемый источник должен иметь подтверждённое основание и покрывать весь период работ. Наследование не продлевает `effective_to`; пересечение границы изменения, неизвестность или конфликт дают уточнение. Штампы, подписи и разрешения остаются наблюдениями до отдельной подтверждённой интерпретации. |
| Существующее право назначенного инспектора            | ID-S1-APPLY и DI-06-ID [spec](specs/document-identification/spec.md); существующий контракт API выше                                                                                                         | Те же назначение на объект, допустимое состояние процесса, `expected_run_id`, версии карточек и основание. Автор из сессии. Решения, новый Run/Job/outbox сохраняются атомарно; replay возвращает прежний результат, устаревшая версия — 409. Новая роль или обходная операция не вводится.                                                                                   |
| Карта закреплена за оригиналом                        | EX-04-ID; [общий контракт Locator](../../CONTRACTS.md)                                                                                                                                                       | `file_id` и `source_sha256` проверяются по единственному серверному PDF-представлению этой редакции. Диапазон страниц берётся из сохранённого PAR, не от клиента. Итоговые выбранные листы содержат также document/revision/artifact и hash артефакта.                                                                                                                        |
| Все страницы перечислены явно                         | Согласованный технический контракт партии; ID-04 и отказ от неизвестной части                                                                                                                                | Каждая физическая страница входит ровно один раз в `sheets` либо `excluded_pages`; хотя бы один лист обязателен. Исключения сохраняются с основанием. Такое покрытие PDF не подтверждает комплектность COM. Потолки 500 страниц и 32 звена цепочки — ограничения реализации, не требования к строительной документации.                                                       |
| Выбор применяется до извлечения                       | ID-S1-PROOF и EX-04-ID; [общие границы ID → EXT](../../CONTRACTS.md)                                                                                                                                         | Каждый контекст получает разрешённые страницы исходных артефактов до anchors/regex/таблиц/cascade. Исключённое или заменённое первое значение не извлекается с последующей фильтрацией. Физические номера страниц, block/bbox и оригинальный PAR сохраняются.                                                                                                                 |
| История и перенос решения неизменяемы                 | ID-PART-HISTORY/ID-S1-PROOF [spec](specs/document-identification/spec.md)                                                                                                                                    | Карта, цепочка, основания, approval и выбор закреплены в новом снимке. Selection/context hash и ключ извлечения отделяют расчёты. Старый протокол не получает новую карту или новый фрагмент задним числом; перенос решения требует совпадения семантических оснований.                                                                                                       |

### Аддитивный API и выбор источников

У `IdentificationRevision` и элемента `RevisionClarification` добавлены optional
nullable поля. Пропущенное поле не меняет решение; `null` явно снимает его:

- `sheet_map`: `{ file_id, source_sha256, sheets: [{ label, page_number }], excluded_pages: number[], basis }`.
- `sheet_replacement`: `{ predecessor_revision_id, replaced_labels: string[], basis }`.

Обозначение — непустая строка до 80 символов, без управляющих символов и переводов
строк, в NFC и без крайних пробелов; семантическая перенумерация не выполняется.
Обоснования непустые, до 4000 символов. Страницы целочисленные, от 1 до фактического
числа страниц. Повторные обозначения, повторные страницы и пересечение с исключениями
отклоняются. Predecessor относится к той же стадии, виду, шифру и области; его карта
обязательна. Цикл, неизвестный predecessor и превышение предела цепочки отклоняются.
Снятие карты при сохранённой частичной связи недопустимо: требуется явно снять связь
либо предоставить новую пригодную карту.

`ComparisonContext.sheet_selection` содержит независимые `reference` и `actual`
со значением `ResolvedSheetSet | null`. Набор содержит `selection_hash`, `chain`
из `{ revision_id, decision_hash }` и `sheets` с `label`, `page_number`,
`document_id`, `revision_id`, `file_id`, `artifact_id`, `artifact_sha256`,
`source_sha256`. Унаследованный лист указывает на собственную редакцию и артефакт,
а не только на последнюю редакцию комплекта. Selection hash учитывает содержание
и решения; техническая смена artifact record ID при повторном использовании PAR
не считается новым предметным основанием сама по себе.

Версии: `sheet-document-identification-v4`, выбор
`explicit-sheet-period-selection-v2`. Извлечения имеют отдельный `selection_key`;
аддитивная миграция — `20260928010000_sheet_extraction_selection`. Прежние снимки
без карты и `sheet_selection` читаются по существующему пути целых документов.
Старый `unsupported_partial_replacement` остаётся в машинных blockers редакции.
Его обход возможен только в resolved context после проверки явной карты, отношения,
цепочки и применимости; другие ограничения, включая mixed/unreadable/integrity,
этим не снимаются.

Синтетический пример контракта: базовый PDF содержит листы 1–8; в новом PDF
страница 1 — явно исключённое разрешение, страницы 2/3/4 сопоставлены листам 1/4/8.
При подтверждённой применимости итог берёт листы 1/4/8 из новых страниц 2/3/4,
а 2/3/5/6/7 — из прежнего оригинала. Диапазон страниц 1–8 нового PDF не выводится.
Пример объясняет алгоритм и не утверждает реальную карту диагностического комплекта.

### Интерфейс и остающиеся вопросы

Карта редактируется рядом с оригиналом: для каждой физической страницы — явное
обозначение либо исключение, отдельные основания карты и замены. Сохранение идёт
через общую кнопку и прежний API. Обычное подтверждение реквизитов не создаёт карту,
связь или approval. При 409 ввод остаётся видимым до явного обновления; сетевой повтор
использует прежний request_id. Историческая карта доступна только для чтения;
переход к странице не создаёт фиктивную цитату или блок доказательства.

За пределами партии остаются: правила разделения сборных PDF, несколько документов
или листов на одной физической странице, добавление/удаление/перенумерация листов,
автоматическое принятие перечня изменений и таблица обязательных штампов/подписей
по видам. Для них требуется отдельное предметное основание. Полная приёмка ID,
комплектность COM, все 132 правила и количественные цели C24 не следуют из этой партии.
Фактические проверки и ещё не завершённые проверки выпуска перечислены в
[evidence.md](evidence.md); состояние задач — раздел 11 [tasks.md](tasks.md).
