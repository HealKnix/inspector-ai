# Проверка MAT-A — 27.09.2026

Закрыты только задачи 1.1–1.4 раннего этапа A: 4 из 25 задач change. Остальные 21 задача остаются открытыми. Основа — рабочее дерево на HEAD `15adb5e`; изменения этапа ещё не закоммичены. Полный контракт и команды воспроизведения: `docs/matrix/MAT_A_CONTRACT.md`.

## 1.1 — read-only inventory

Снимок рабочей PostgreSQL получен одной транзакцией `REPEATABLE READ READ ONLY`. Изменений и переутверждения рабочих правил не было. Сохранены `docs/matrix/mat-a-legacy-inventory-2026-09-27.json` и соответствующий manifest с hashes источников и каждой approved версии. Inventory содержит 132 уникальных кода P001–P132 и 104 RuleVersion. Обнаружены 13 approved записей для 12 параметров; у P002 имеются v2 и v5, эффективна v5. У 12 эффективных версий только 11 comparison: P004 остаётся без comparison. Ошибка P019 с извлечением номера пункта не объявлена исправленной. Seed содержит только P002/P007/P015.

Byte SHA-256 inventory: `012e5634e7450fb82ac5a395b6822afd4b6f7b3ee7559129827614e7ce591199`. Канонический JSON SHA-256: `584d871ec0047ab6f024a8c688834c4960677ee007da71d8bea2f3fefef22799`. Исторический JSONL hash совпадает после явной нормализации Windows CRLF в LF; все 132 raw-строки равны строкам каталога. `node docs/matrix/verify-mat-a-inventory.mjs` прошёл: hashes/132 строки/104 версии/13 approved/12 параметров проверены. Legacy passport, основания, regression и корпусная точность явно неизвестны.

## 1.2 — паспорт и миграция

Аддитивная миграция `20260927010000_matrix_review_gate` добавляет RulePassport и RuleRegressionReport, FK и индексы; триггеры запрещают UPDATE/DELETE записей. Исторические RuleVersion остаются читаемыми. Для deprecated версии разрешено сохранять первоначальные approvedBy/approvedAt вместо удаления. Миграция не переписывает существующие данные.

`MatrixReviewService` сохраняет версионированный паспорт draft с серверными hashes импорта, raw-строки и исходным триггером; повтор идентичного содержания идемпотентен. Неизвестные нормы остаются null. Проверки на отдельной PostgreSQL БД применили реальные старые миграции, создали историческую approved версию, затем применили новую миграцию и подтвердили неизменность исторической версии и raw-строки. Проверены новая редакция, replay, запрет изменения/удаления и неизвестное обязательное основание.

## 1.3 — исполняемая регрессия

`matrix-review-contract.ts` задаёт исполняемые JSON Schema; `matrix-regression.ts` вызывает существующие extraction/comparison engines. Проверяются hash каждого ParseArtifact, обязательные категории по ветвям, точные value/raw value/unit/full locator/verdict. Report привязан к плану, comparison, применимости, паспорту, fixtures и версиям исполнителей; сохраняет происхождение примеров и причины исключения категорий. Curated пример требует reference и permission. Synthetic report всегда имеет `corpus_accuracy: null`.

Unit-проверки отклоняют неверные artifact hash, value, unit, locator и verdict, отсутствующие категории, неизвестные операторы, неподтверждённый численный порог, неподдержанное округление и ошибочно названный uncertain пример. Изменение плана/паспорта инвалидирует прежний report. Ни synthetic fixtures, ни результаты этих тестов не утверждают качество текущих 12 правил или точность на независимом корпусе.

## 1.4 — gate утверждения

Прямой admin approve теперь внутри одной транзакции проверяет текущий passport/report/rule/source hash и engine fingerprint. Все изменения одного параметра используют общий advisory lock. Успешное утверждение и снятие прошлой версии атомарны с audit, в котором сохранены IDs/hashes passport/report. Новый `review-contract` API предоставляет схемы для CMP/C07/GEO/C09; порт расширения и ответственность операторов описаны в контракте. Неизвестный будущий оператор не получает допуск по одной декларации версии.

Batch не вызывает approve; dry-run остаётся диагностикой. LLM создаёт draft и проходит тот же общий approve gate. `matrix:seed` создаёт только отсутствующие draft; существующие версии не меняются. PG/HTTP проверки подтверждают: approve без report даёт 422; поддельный готовый report отвергается; инспектор не может записать passport; совместимый draft с исполненными fixtures утверждается; конкурентные approve оставляют одну активную версию; ошибка обязательного audit откатывает всю транзакцию.

## Выполненные проверки

Команды запускались через локальные Node entry points, потому что Bun отсутствовал в PATH; менеджер зависимостей и lockfile не заменялись.

| Проверка                                                                                                                 | Результат                         |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `node ../node_modules/prisma/build/index.js generate` из backend                                                         | Prisma Client 7.10.0 сгенерирован |
| `node ../node_modules/vitest/vitest.mjs run src/modules/extraction` из backend                                           | 6 файлов, 56 тестов прошли        |
| `node ../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/matrix-review.test.ts` из backend | 8 PG/HTTP тестов прошли           |
| `node ../node_modules/typescript/bin/tsc --noEmit --incremental false` из backend                                        | exit 0                            |
| `node ../node_modules/@nestjs/cli/bin/nest.js build --path tsconfig.build.json` из backend                               | exit 0                            |
| Scoped ESLint изменённых MAT файлов, fixtures и inventory verifier                                                       | exit 0                            |
| `node docs/matrix/verify-mat-a-inventory.mjs`                                                                            | все проверки пройдены             |

PG suite использовал отдельную случайную `matrix_review_<uuid>` на тестовом PostgreSQL :25432 и удалил только её; общая тестовая и рабочая БД не сбрасывались. HTTP tests предоставляют аутентифицированный контекст через тестовый middleware и используют настоящий RolesGuard; проверка криптографии JWT относится к существующему auth suite.

`openspec validate add-reviewed-matrix-release --strict` завершился успешно: change valid.

## Границы результата

Production-миграция в рабочую БД этим шагом не применялась: она входит в развёртывание поставки. Точный legacy snapshot передан OFF для отдельного восстановления на пустую разрешённую БД без нового approve. Исправление P019/P004/остальных 12, предметная проверка норм, операторы будущих changes, остальные 120 строк, UI и immutable release manifest 132/132 остаются открытыми задачами следующих этапов. Материалы regression могут содержать цитаты fixtures; перенос curated данных требует явно подтверждённого разрешения и политики поставки.
