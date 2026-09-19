# Evidence — живой прогон среза извлечения

Дата: 2026-09-19. Окружение: `docker compose` (postgres 17, rabbitmq 4.1, redis,
parser PP-DocLayout/PP-OCRv5, backend, extraction-worker :3004). Ветка
`feat/evidence-extraction`.

## Контур

- `migrate` применил `20260919020000_matrix_and_extraction` (7 таблиц).
  Требуется пересборка migrate-образа при новых миграциях — compose иначе
  переиспользует старый образ.
- Импорт каталога в реальную PostgreSQL:
  `bun run matrix:import` → 132 строки `matrix_rows`, SHA-256 JSONL и
  origin `matrix-132.xlsx` сверены; повторный импорт идемпотентен.
- Сид: `matrix:seed` → 3 approved-правила (P002, P007, P015, v1).

## Документ и пайплайн

Файл: `23.009-ПЗ_стр8-25_ТЭП.pdf` (вырезка стр. 8–25 проектного ПЗ из корпуса
«Октябрьская 103», 348 323 байта — полный ПЗ 50.9 МБ за лимитом upload).

`upload → parse → classify → extract` — все succeeded:

- Артефакт `f0183566`: 18 страниц, 1282 блока, 72 табличные ячейки,
  quality=LOW_QUALITY (LAYOUT_BOUNDARY_CONFLICT, TABLE_STRUCTURE_REJECTED,
  skipped-регионы без OCR-замены).
- Классификация: `stage=null`, `method=none`, reasons
  `no_reliable_own_evidence`+`llm_disabled` — честный unknown (вырезка без
  титульника), EvidenceGroup фиксирует `stage:null`, роль `unknown`.

## Итоги извлечения (цикл 3, ruleset 7f9ac4a6)

| Параметр                    | Исход       | Значение       | Доказательство                                                           |
| --------------------------- | ----------- | -------------- | ------------------------------------------------------------------------ |
| P002 «Общая площадь здания» | extracted   | 16 605,70 (m2) | стр. 8, блок p8-b15, bbox есть, quote «16 605,70»                        |
| P007 «Этажность»            | extracted   | 17             | стр. 7, блок p7-b75 («Количество этажей» → «эт. 17, 5 + подземный этаж») |
| P015 «Категория надёжности» | no_evidence | —              | параметр отсутствует в вырезке — честный исход                           |

Админ-цикл пройден на живом API: `POST rows/:code/rules` (draft v2) →
`POST rules/:id/dry-run` (на артефакте объекта) → `POST rules/:id/approve` →
смена fingerprint → переизвлечение воркером. Старые v1 помечены `deprecated`.

По корпусу (20 артефактов × 3 параметра): observed исходы `extracted`,
`ambiguous` (P007: конфликт «7» vs «11» — сохранены все alternatives с
локаторами), `no_evidence`, `unreadable`. 13 задач `extraction_superseded` —
корректный fencing при смене fingerprint, не ошибки.

## Найденные и исправленные дефекты

1. `findAnchorHits` пропускал все `include_in_main=false` блоки. Контракт
   парсера использует флаг и для OCR-аудит-копий (пропускать — иначе дубли), и
   для skipped-регионов без замены (единственное доказательство). Фикс:
   пропускаем только при method ∈ {ocr, table_ocr, hybrid}; skipped — ищем.
   Регрессионный тест в `extraction-engine.test.ts` (16/16).
2. `approve` ставил `deprecated` старой версии, не очищая `approved_at` →
   нарушение `rule_versions_approval_check` (500). Фикс: deprecation обнуляет
   `approvedBy/approvedAt`; история утверждений остаётся в `audit_events`.
3. Dockerfile backend не поставлял `scripts/` и `matrix-132.xlsx` —
   `matrix:import` в контейнере не находил файлы. Добавлены COPY-строки.

## Проверенные команды

- `POST /api/v1/admin/matrix/search` — окна с якорями (после фикса: 3 окна,
  стр. 5/7/8). Внимание: кириллица в теле — только UTF-8 bytes
  (`--data-binary @file`), Git-Bash `curl -d` портит кодировку.
- `GET /api/v1/objects/:id/extractions` (INSPECTOR + object_access) — 3
  результата с локаторами.
- `GET /api/v1/objects/:id/evidence-groups` — группы по параметрам,
  `ruleset_hash` текущего цикла.
- `POST rows/:code/draft-llm` → 409 `LLM-контур выключен` — гейт работает.

## Hit-rate и ограничения среза

- На загруженном ПД-фрагменте: 2/3 параметра extracted, 1/3 честный
  `no_evidence` (P015 вне диапазона страниц). Поиск якорей: найдены после
  фикса include_in_main (до — 0 окон на присутствующем тексте).
- Hit-rate по `public_train_checks.jsonl` не измерялся: файл содержит 10
  проверок другого объекта (Тюменская-5) и другой схемы параметров
  (IOS4-_/FREE-_), к посевным P0xx-правилам не применимо.
- Артефакт LOW_QUALITY: ТЭП-таблица не собрана парсером (skipped-регионы),
  значения извлечены regex-фолбэком по текстовым блокам; table_lookup-шаг
  остаётся корректным путём для структурированных таблиц.
- `stage=null` у фрагмента → члены EvidenceGroup без роли expected/actual —
  задумано, не дефект.
- LLM-драфт не исполнялся (CLASSIFICATION_LLM_ENABLED=off): гейт 409
  проверен, сам путь генерации на живом контуре не прогнан.
- UI-панели не проверялись в браузере; проверен слой данных (API контракты,
  возвращающие значения и локаторы, которые панель рендерит).
