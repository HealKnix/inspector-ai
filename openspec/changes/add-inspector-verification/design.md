# Дизайн: верификация инспектором

## D1. Протокол-центричная модель

Находки живут внутри версии протокола, а не «плывут» по объекту.
Генерация материализует снимок `evidence_groups` текущего запуска;
решения мутируют строки активной версии; регенерация создаёт новую
версию (`version = max+1`, предыдущая → `superseded`). Это прямо следует
§9.3 ТЗ: протокол версионируется, дозагрузка создаёт новую версию,
предыдущая сохраняется.

Альтернатива «находка вне протокола с протоколом-представлением»
отклонена: она требует двухсторонней синхронизации при пересчёте и
размывает ответ на вопрос «по какому снимку принято решение».

## D2. Триггер генерации — явное действие

`POST protocol/generate` — действие инспектора, а не автоматика по
«все задачи завершены»: единого события окончания пайплайна нет
(задачи идут по артефактам асинхронно), а ТЗ связывает READY именно с
сохранённым протоколом. Генерация отклоняется 409, если по текущему run
есть задачи в нефинальных состояниях (`queued`, `processing`) — протокол
не должен фиксировать половину обработки как факт. `failed` не блокирует:
это терминальное состояние, затронутые параметры честно уходят в
`MISSING_EVIDENCE`.

Генерация идемпотентна по содержимому: если активная версия уже
построена на том же `findings_hash` (см. D5), возвращается она, а не
создаётся копия.

## D3. Статусы находок — объединённая шкала §9.2/§9.3

ТЗ использует две шкалы: исход параметра (§9.2: CANDIDATE,
NEGATIVE_VERIFIED, MISSING_EVIDENCE, NOT_COMPARABLE,
CLARIFICATION_REQUIRED, SUSPICION, NOT_APPLICABLE) и результат
верификации (§9.3: CANDIDATE → CONFIRMED_VIOLATION | NEGATIVE_VERIFIED |
CLARIFICATION_REQUIRED). Храним один enum `finding_status`:

```
CANDIDATE CONFIRMED_VIOLATION NEGATIVE_VERIFIED CLARIFICATION_REQUIRED
MISSING_EVIDENCE NOT_COMPARABLE NOT_APPLICABLE
```

`NEGATIVE_VERIFIED` покрывает и авто-негатив (verdict `match`, решения
нет), и отклонение инспектором (решение есть, reason_code+комментарий
обязательны) — различаются по наличию `finding_decisions`. SUSPICION
(свободный поиск, §9.2) — вне среза: движок не реализован.

## D4. Маппинг: gate комплектности до предметного вердикта

Для каждой группы `(parameter_code, scope_key)`:

1. `parameterGate` (completeness-engine, CO-04) по результату последней
   оценки: применимость, достаточность стадий, разрешённость ревизий.
   Gate `NOT_APPLICABLE`/`MISSING_EVIDENCE`/`CLARIFICATION_REQUIRED`
   → одноимённый статус находки, вердикт не читается.
2. Gate `READY` → читаем `verdict.status`:
   - `discrepancy` → `CANDIDATE`
   - `match` → `NEGATIVE_VERIFIED`
   - `expected_missing`/`actual_missing` → `MISSING_EVIDENCE`
   - `expected_ambiguous`/`actual_ambiguous` → `CLARIFICATION_REQUIRED`
   - `not_comparable`/`no_comparison` → `NOT_COMPARABLE` (+ detail)
3. Параметр матрицы без группы → `MISSING_EVIDENCE` (evidence_absent).

Находка всегда атомарна по `(protocol_id, parameter_code, scope_key)` —
общего `PARTIALLY_CONFIRMED` нет и не будет (запрет §9.3). Разнесение
по корпусам/секциям остаётся за scope_key будущих срезов GEO.

## D5. Отпечаток доказательств и перенос решений

`members_fingerprint = sha256(members + verdict.spec + rule_version_ids)`
— отпечаток того, что видел инспектор. При регенерации:

- fingerprint совпал → решение и история переносятся (копией
  `finding_decisions` со ссылкой на новую находку);
- fingerprint изменился → находка новой версии стартует с расчётного
  статуса, старое решение остаётся в старой версии.

Решения переносятся только вперёд из активной версии и только на находки
с совпадающим ключом `(parameter_code, scope_key)`.

`findings_hash` протокола — sha256 над отсортированными
`parameter_code|scope_key|status|members_fingerprint` — определяет
идемпотентность generate.

## D6. Решения: история + оптимистичная конкуренция + receipt

`finding_decisions` — иммутабельная история (actor, action, from/to
status, reason_code, comment, время). Текущее состояние — на `findings`
(`status`, `decided_by/at`, `reason_code`, `comment`, `row_version`).

`POST decision` в одной транзакции: lock объекта → requireAccess →
проверка статуса процесса (READY/VERIFYING) → replay по
`finding_decision_receipts (user_id, object_id, request_id)` →
проверка `finding_version` (несовпадение → 409) → переход по таблице
допустимых → update + decision + receipt + audit + первый переход
процесса в VERIFYING / переход в COMPLETED при нуле CANDIDATE.

Допустимые переходы: CANDIDATE→CONFIRMED_VIOLATION (confirm),
CANDIDATE→NEGATIVE_VERIFIED (reject, reason+comment),
CANDIDATE→CLARIFICATION_REQUIRED (clarify, comment),
CLARIFICATION_REQUIRED→CANDIDATE (повторная постановка — `reopen`),
CONFIRMED_VIOLATION/NEGATIVE_VERIFIED→CANDIDATE (`reopen`, до
финализации). Решения над авто-негативами и служебными статусами
(MISSING_EVIDENCE и др.) не принимаются.

## D7. Переходы процесса

Владелец — этот модуль; везде advisory lock + проверка текущего статуса:

```
generate            PENDING|READY|VERIFYING|COMPLETED → READY
первое решение      READY → VERIFYING
нет CANDIDATE       VERIFYING → COMPLETED
finalize            COMPLETED|VERIFYING → FINALIZED (только 0 CANDIDATE)
finalize/cancel     FINALIZED → COMPLETED (ADMINISTRATOR + причина)
```

Дозагрузка (admission) в READY/VERIFYING/COMPLETED по-прежнему
разрешена и откатывает процесс в PENDING с новым run — после
переобработки инспектор генерирует следующую версию протокола.
В FINALIZED загрузка закрыта тем же admission-слоем.

## D8. Контент протокола

`protocols.content` (JSONB, schema_version=1): сценарий загрузки,
счётчики находок по статусам, ссылка на результат комплектности,
массив находок (parameter_code, scope_key, статус, expected/actual из
вердикта, ссылки на evidence). Это структурированная форма §9.2 для
frontend и будущего экспорта; рендер PDF/DOCX по Приложению 2 —
отдельный срез (C10 export), контракт ему не мешает.

## D9. Роли и открытые вопросы

- Решения, generate, finalize — инспектор с `ObjectAccess` (тот же
  `requireAccess`, что и остальные операции с объектом).
- `finalize/cancel` — `ADMINISTRATOR` по §9.3 («отменяется
  администратором»). Упомянутый в ТЗ «супервизор» отдельной ролью в
  enum `Role` не представлен — реализация ждёт решения владельца;
  расширение — отдельный предметный вопрос, не предположение.
- Шифр/редакция/статус утверждения документа слоем ID пока не
  извлекаются — карточка находки отдаёт file_id, стадию, страницы,
  bbox, quote; недостающие поля — явные null, не выдуманные значения.

## Риски

- Параметры без утверждённых правил (большинство из 132) честно
  попадают в `MISSING_EVIDENCE`/`NOT_COMPARABLE`, а не «проверены».
- Перенос решений по fingerprint чувствителен к составу members:
  эквивалентная пересборка группы без изменения значений сохраняет
  fingerprint (members детерминированы rebuildGroups).
- Concurrent generate двух инспекторов: сериализуется advisory lock;
  второй получает идемпотентный ответ по findings_hash.
