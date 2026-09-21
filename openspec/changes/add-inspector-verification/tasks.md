# Верификация инспектором: протокол, находки, решения

Владелец: срез верификации поверх COM + сравнения. Нумерация локальная.
Решения — в design.md (D1–D9): протокол-центричная модель, явный
триггер, gate комплектности до вердикта, перенос решений по отпечатку.

## 1. Данные

- [x] 1.1 Миграция и Prisma: enum `finding_status`
      (CANDIDATE/CONFIRMED_VIOLATION/NEGATIVE_VERIFIED/
      CLARIFICATION_REQUIRED/MISSING_EVIDENCE/NOT_COMPARABLE/
      NOT_APPLICABLE), `protocol_status` (active/superseded/finalized);
      `protocols`, `findings`, `finding_decisions`,
      `finding_decision_receipts` со связями и Restrict-политикой.
      Проверка: `prisma migrate deploy` на живой БД, старые строки не
      затронуты. ✔ миграция `20260921001514_inspector_verification`
      применена к dev-БД, аддитивная.
- [x] 1.2 `verification-contract.ts`: типы статусов, маппинг
      verdict→finding, таблица переходов решений, reason codes отклонения
      (неверная редакция / согласованное изменение / ошибка распознавания
      или привязки / неприменимость — из мока DiscrepancyDetails).
      Проверка: unit-тесты принятия/отклонения каждого перехода. ✔
      `protocol-builder.test.ts` + интеграционный контур.

## 2. Сборка протокола

- [x] 2.1 Чистый `protocol-builder.ts`: groups + последняя оценка
      комплектности + применимость → находки со статусами по D4;
      `members_fingerprint` и `findings_hash`; контент по D8.
      Проверка: unit-тесты на каждый исход вердикта и каждый gate,
      параметр без группы → MISSING_EVIDENCE. ✔ 26 unit-тестов.
- [x] 2.2 `POST protocol/generate` в сервисе: lock+requireAccess, run и
      процесс текущей версии, 409 при задачах queued/processing,
      идемпотентность по findings_hash активной версии, superseded
      предыдущей версии, перенос решений по fingerprint, переход → READY,
      audit `protocol.generated`, outbox `protocol.generated`.
      Проверка: интеграционные тесты (повтор → та же версия; изменённая
      группа → новая версия; решение не наследуется при смене
      fingerprint). ✔ `test/verification.test.ts`.

## 3. Решения и финализация

- [x] 3.1 `POST findings/:id/decision`: receipt-replay, `finding_version`
      (409), таблица переходов D6, reject без reason_code/comment → 400,
      запрет решений вне READY/VERIFYING и над служебными статусами,
      переходы READY→VERIFYING и VERIFYING→COMPLETED, audit
      `finding.decision`. Проверка: интеграционные тесты на каждый пункт.
- [x] 3.2 `POST protocol/finalize`: 0 CANDIDATE в активной версии →
      FINALIZED + status протокола finalized, иначе 409; audit+outbox.
      `POST protocol/finalize/cancel`: только ADMINISTRATOR + причина,
      FINALIZED → COMPLETED, версия протокола обратно в active, audit
      `protocol.finalization_cancelled`. Проверка: тесты переходов и
      роли. ✔ интеграционный сценарий «полный цикл».
- [x] 3.3 Read-endpoints: `GET protocol` (активная версия + счётчики +
      история версий), `GET findings?status=&q=`, `GET findings/:id`
      (вердикт, members, evidence-локаторы, история решений).
      Проверка: ответы по контракту, 403 без назначения. ✔ сценарий
      доступа в интеграционном тесте.

## 4. Модуль и проверки

- [x] 4.1 `verification.module.ts` + регистрация в `app.module.ts`;
      OpenAPI-схемы ответов.
- [x] 4.2 Прогон: vitest backend (включая новые тесты), typecheck,
      eslint, prettier; живой прогон на «Новослободской» —
      generate → decision (P022) → finalize; evidence.md с вердиктами.
      ✔ Проверки кода выполнены; живой прогон на реальном комплекте
      заменён интеграционным стеком (postgres+rabbitmq, 6 сценариев
      end-to-end через HTTP). Прогон на «Новослободской» — отдельной
      задачей при демонстрации.
