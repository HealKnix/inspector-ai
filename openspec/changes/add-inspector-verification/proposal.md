# Верификация инспектором: протокол, находки, решения

## Why

Предварительный вердикт сравнения (`evidence_groups.verdict`,
add-evidence-comparison) отвечает на вопрос «совпадает ли значение», но не
является находкой: по §9.1–9.3 ТЗ протокол формируется отдельным действием,
каждая находка получает статус верификации, решение принимает инспектор с
обоснованием, а результат финализируется и хранится версиями. Сегодня этого
контура нет: вердикт отдаётся read-only в UI, статусы процесса
READY/VERIFYING/COMPLETED/FINALIZED нигде не выставляются, решений и
протокола в БД нет.

Мок-страница `/verification` уже задаёт UX-контракт: список находок,
карточка expected/actual с доказательствами, решения «Подтвердить /
Отклонить / Требует уточнения». Срез реализует backend под этот контракт.

Источник требований —
[итоговый PDF и приложения](../../../docs/requirements/SOURCES.md), §9.

## What Changes

- Явное действие `POST /v1/objects/:objectId/protocol/generate`: снимок
  `evidence_groups` текущего запуска превращается в версионированный
  протокол с находками. Генерация отклоняется (409), пока по запуску есть
  незавершённые задачи обработки.
- Сущности `Protocol` (версии, сценарий загрузки, хэши входов и набора
  правил, структурированный контент) и `Finding` (статус верификации,
  снимок вердикта, отпечаток доказательств, текущее решение).
- Маппинг исходов сравнения в статусы находок по §9.2 ТЗ с учётом
  `parameterGate` комплектности: `discrepancy` → `CANDIDATE` только при
  gate `READY`; `match` → `NEGATIVE_VERIFIED` (авто-негатив); недостаток
  доказательств → `MISSING_EVIDENCE`; конфликт данных или неразрешённая
  стадия → `CLARIFICATION_REQUIRED`; несравнимое/без спеки →
  `NOT_COMPARABLE`; параметр неприменим → `NOT_APPLICABLE`.
- `POST /v1/objects/:objectId/findings/:findingId/decision`: решения
  инспектора `confirm | reject | clarify` с историей `finding_decisions`,
  идемпотентностью по `request_id` (receipt), оптимистичной конкуренцией
  по `finding_version` и обязательными `reason_code`+`comment` при
  отклонении.
- Переходы процесса: READY после сохранения протокола; VERIFYING при
  первом решении; COMPLETED когда не осталось `CANDIDATE`;
  `POST protocol/finalize` → FINALIZED только при нуле кандидатов;
  `POST protocol/finalize/cancel` → COMPLETED для администратора с
  обязательной причиной.
- Регенерация до финализации создаёт новую версию протокола; решения
  переносятся только на находки с неизменным отпечатком доказательств —
  изменённые доказательства решение не наследуют (§9.3).
- Аудит и outbox-события `protocol.generated`, `finding.decision`,
  `protocol.finalized`, `protocol.finalization_cancelled` по конверту
  CONTRACTS.md.

## Capabilities

### New Capabilities

- `inspector-verification`: версионированный протокол из снимка
  доказательств, атомарные находки со статусами верификации, решения
  инспектора с аудитом и финализация по §9 ТЗ.

### Modified Capabilities

- `document-evidence-comparison`: вердикт `discrepancy` становится входом
  находки-кандидата; сам вердикт и его вычисление не меняются.
- `document-completeness`: результат оценки и `parameterGate` используются
  как обязательный gate перед предметной находкой; сама оценка не меняется.

## Impact

- **БД**: новые таблицы `protocols`, `findings`, `finding_decisions`,
  `finding_decision_receipts`; enum `finding_status`, `protocol_status`.
- **API**: 7 endpoint'ов под `v1/objects/:objectId` (protocol ×3,
  findings ×3, decision). Все за `JwtAuthGuard` + `requireAccess`.
- **Процесс**: первый обладатель переходов READY/VERIFYING/COMPLETED/
  FINALIZED; дозагрузка по-прежнему разрешена admission-слоем в
  READY/VERIFYING и возвращает процесс в PENDING с новым run.
- **Frontend**: мок `/verification` получает реальный контракт; замена
  мока — отдельный срез.
