# ACC evidence

Дополнительный контрактный контроль того же среза: все132 внутренних `P001…P132` сопоставлены с внешними кодами участнического каталога по parameter_id/matrix_row/name/unit; расхождений0. Сохранён [parameter-code-map.json](../../../docs/acceptance/contracts/parameter-code-map.json) с хешами обоих источников; общий self-check повторно PASS. `openspec validate add-release-acceptance --strict` — PASS.

## 2026-09-27 — ACC-method, задачи1.1–1.5

Реализован самостоятельный проверяемый комплект [docs/acceptance](../../../docs/acceptance/README.md) и [scripts/acceptance](../../../scripts/acceptance/check-method.mjs). Код приложения, внешние enum, package/lock и общая release-plan не менялись. Методика не утверждает прохождение требований продукта.

| Задача | Артефакт и фактическая проверка                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1    | `requirements.json`:73 записи, отдельные H/F, владельцы/источники/проверки; C01–C24 и все6High. Self-check проверяет полноту/уникальность. Все продуктовые исходы NOT_RUN. Основной PDF/3приложения независимо сверены поSHA. Q&A SHA зафиксирован;35ячеек H независимо сопоставлены с первичным XLSX XML, применимые более поздние ответы прочитаны из предоставленной переписки.                                                                                                                              |
| 1.2    | Официальный split сохранён без изменения; технический train58/validation145 внутриTRAIN_PUBLIC, hidden213 только у оценщика. Минимальный manifest фиксирует object/file/hash/page metadata.203/203 разрешённых оригиналов независимо проверены поSHA,1 749 666 950байт.7data-контрактов совпали с checksums и публичным архивом. Hidden документы/ответы не читались; пять категорий и процедура фиксации/независимости заданы как обязательный вход будущей приёмки, их фактический состав пока не аттестован. |
| 1.3    | Побайтная submission schema поSHA75c58b…4a8d7; отсутствие version/$id явно отмечено. Atomic object+parameter+location поQA H17. Ajv2020-12, отдельно semantic preflight; valid/invalid synthetic examples. Контракт передан ведущему дляEXPORT, адаптер продукта не реализуется этой задачей. Старый100балльный scoring отделён от позднегоQA H16(40баллов).                                                                                                                                                    |
| 1.4    | Формулы/знаменатели/CI95/coverage/abstention закреплены; независимые функции и17Vitest контролей проверяют OCR/NFC/Unicode, поля, confusion, stale/missing evidence, exactfile/page/IoU, duplicates, bootstrap, empty sample и external schema. Printed≥300dpi и premarked exclusions обязательны; eligible abstention остаётся в знаменателе.                                                                                                                                                                  |
| 1.5    | H100стенд из ответа21.09, cold/warm/resources, монотонные start/end границы, все15§11 сценариев и два признака baseline/tolerance сохранены. ДляH DWG исключёнQA H7, upload50/200МБ подтверждёнQA H14. Остаточные вопросыF(DWG,10×50МБпротив200МБ) и трактовка пограничных допусков сформулированы вACC-D1–D3 и переданы ведущему для решения владельцем; лимиты/форматы не расширены.                                                                                                                          |

Выполненные команды из корня репозитория:

```text
node scripts/acceptance/inventory.mjs .. docs/acceptance/contracts
  PASS:416manifest;203public/213hidden;132codes;7checksum matches;7archive matches;0cross-split duplicateSHA.
node scripts/acceptance/verify-public-files.mjs .. docs/acceptance/contracts/public-file-integrity.json
  PASS:203/203original files,1749666950bytes; hidden_files_read=0.
node scripts/acceptance/check-method.mjs
  PASS:73requirements,24roadmap,6High; primary repository sources/contract digests, split/integrity and controls.
node node_modules/vitest/vitest.mjs run --config scripts/acceptance/vitest.config.mjs
  PASS:1testfile,17tests.
node node_modules/eslint/bin/eslint.js scripts/acceptance
  PASS.
node node_modules/prettier/bin/prettier.cjs --check "scripts/acceptance/*.mjs" "docs/acceptance/*.md" "docs/acceptance/*.json" "docs/acceptance/fixtures/*.json"
  PASS. Exact external contract JSON excluded from formatting to preserve original bytes.
```

Результаты источников: [inventory](../../../docs/acceptance/contracts/input-inventory.json), [original byte verification](../../../docs/acceptance/contracts/public-file-integrity.json), [source pins](../../../docs/acceptance/sources.json). Контрольные числа: CER0.2/accuracy0.8/WER1/3; IoU0.5; TP=FP=FN=TN=1→P/R/F1/FPR0.5; synthetic bootstrapCI[0,1]; пустойF1null.

Границы доказательства: publicly supplied10positive/page-level и5negative/GOLD_READY_SECOND_REVIEW не заменяют экспертный coordinate/OCRGOLD; один объект наdevelopment-validation недостаточен дляCI. Классический polygon-IoU, реальный exporter-output, baseline12/11, hidden-quality, GPUperformance/нагрузка/UX и независимый финальный offline относятся к последующим задачам.2.1не закрывается наличием отдельных metric primitives: полный dataset/report runner с категориями ещё нужен. Промышленная Fприёмка и предметные разрешения не отмечены выполненными.
