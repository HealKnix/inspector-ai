import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",")}}`
      : JSON.stringify(value);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(resolve(root, path));
const json = (path) =>
  JSON.parse(
    read(path)
      .toString("utf8")
      .replace(/^\uFEFF/, ""),
  );
const codes = Array.from(
  { length: 132 },
  (_, i) => `P${String(i + 1).padStart(3, "0")}`,
);
const fields = [
  "parameter_id",
  "pd_section",
  "name",
  "unit",
  "source_pd",
  "source_rd",
  "source_id",
  "trigger",
  "criticality",
];
const ports = {
  scalar: [
    "comparison",
    "CMP",
    "baseline_scalar_only",
    "Численный оператор существует; единицы, порог, округление, тип величины и контекст требуют паспорта и regression.",
  ],
  "ordered-class": [
    "ordered_class",
    "CMP/MAT",
    "adapter_required",
    "Нужен утверждённый справочник и версионированный порядок/эквивалентность классов; число в названии не ранг.",
  ],
  geometry: [
    "geometry",
    "GEO",
    "adapter_required",
    "Нужны калибровка, область, единицы, погрешность и GeometryResult.",
  ],
  presence: [
    "presence",
    "C07/COM",
    "adapter_required",
    "Отрицательный факт требует подтверждённой полноты в области, а не отсутствия OCR/evidence.",
  ],
  composite: [
    "composite",
    "C07",
    "adapter_required",
    "Все ветви относятся к одной области и редакции; неизвестная ветвь сохраняет неопределённость.",
  ],
  inventory: [
    "inventory",
    "EXT/C07",
    "adapter_required",
    "Нужны идентичность позиций, состав и охват; нельзя сравнивать только первое число.",
  ],
  approval: [
    "approval_scope",
    "ID/C07",
    "adapter_required",
    "Нужен источник утверждения/согласования и связь с конкретным изменением.",
  ],
  event: [
    "event",
    "C09",
    "adapter_required",
    "Нужен предоставленный формат источника, идентификаторы и границы полноты.",
  ],
  temporal: [
    "temporal",
    "C09/C07",
    "adapter_required",
    "Нужны период действия, часовой пояс и правила связи события/состояния.",
  ],
};

export function assessmentsFrom(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift() !== "code|families|scope|required_facts|blocking_question")
    throw new Error("Assessment header mismatch");
  const rows = lines.map((line) => {
    const values = line.split("|");
    if (values.length !== 5 || values.some((v) => !v.trim()))
      throw new Error("Incomplete manual assessment");
    const [code, families, scope, requiredFacts, question] = values;
    const list = families.split(",");
    if (list.some((f) => !ports[f]) || new Set(list).size !== list.length)
      throw new Error(`Invalid family: ${code}`);
    return {
      code,
      families: list,
      scope,
      required_facts: requiredFacts,
      blocking_question: question,
    };
  });
  if (canonical(rows.map((r) => r.code)) !== canonical(codes))
    throw new Error(
      "Exactly one ordered manual assessment for P001–P132 is required",
    );
  return rows;
}

function normalizeInventory(value) {
  return value.tables
    ? {
        ...value,
        rows: value.tables.matrix_rows,
        rules: value.tables.rule_versions,
        imports: value.tables.matrix_imports,
        review_counts: {
          passports: value.tables.rule_passports.length,
          reports: value.tables.rule_regression_reports.length,
        },
      }
    : value;
}

export function makeLedger(
  catalog,
  assessments,
  currentInput,
  legacyInput,
  provenance,
) {
  const current = normalizeInventory(currentInput);
  const legacy = normalizeInventory(legacyInput);
  if (canonical(catalog.map((r) => r.parameter_code)) !== canonical(codes))
    throw new Error("Catalog code set mismatch");
  for (const inventory of [current, legacy]) {
    if (
      inventory.capture_mode !== "repeatable_read_read_only" ||
      inventory.rows.length !== 132
    )
      throw new Error("Incomplete inventory");
    for (const row of inventory.rows) {
      if (
        canonical(row.raw) !==
        canonical(catalog.find((r) => r.parameter_code === row.parameter_code))
      )
        throw new Error(`Inventory raw mismatch: ${row.parameter_code}`);
    }
  }
  const records = catalog.map((raw, index) => {
    const assessment = assessments[index];
    if (assessment.code !== raw.parameter_code)
      throw new Error("Assessment/catalog association mismatch");
    const versions = current.rules.filter(
      (r) => r.parameter_code === raw.parameter_code,
    );
    const historical = legacy.rules.filter(
      (r) => r.parameter_code === raw.parameter_code,
    );
    const approved = versions
      .filter((r) => r.status === "approved")
      .sort((a, b) => b.version - a.version);
    const effective = approved[0] ?? null;
    const branch = ([operator, owner, status, limitation], id) => ({
      id,
      operator,
      owner,
      required: true,
      support_status: status,
      limitation,
      basis: null,
      regression_report: null,
    });
    const branches = [
      branch(
        [
          "extraction",
          "EXT",
          "baseline_text_table_only",
          "regex/table_lookup/cascade существуют; поле, единица и локатор проверяются для конкретной строки.",
        ],
        "extraction",
      ),
      ...assessment.families.map((family) => branch(ports[family], family)),
    ];
    const risk = [];
    if (effective && effective.comparison === null)
      risk.push("effective_comparison_missing");
    if (
      effective &&
      effective.comparison?.kind !== "equals" &&
      ["text", "enum"].includes(effective.plan.type)
    )
      risk.push("legacy_string_value_with_numeric_comparator");
    if (raw.parameter_code === "P019")
      risk.push("historical_list_number_1_extracted_as_coefficient");
    if (raw.parameter_code === "P056")
      risk.push("legacy_rebar_A240_anchor_does_not_describe_steel_grade_C");
    if (raw.parameter_code === "P009")
      risk.push("legacy_0_01m_tolerance_without_confirmed_basis");
    const stageSources = {
      PD: raw.source_pd,
      RD: raw.source_rd,
      ID: raw.source_id,
    };
    return {
      parameter_code: raw.parameter_code,
      matrix_row: raw.matrix_row,
      raw_source_fields: Object.fromEntries(
        fields.map((key) => [key, raw[key]]),
      ),
      raw_catalog_record: raw,
      raw_catalog_record_sha256: hash(canonical(raw)),
      source_assessment: {
        status: "source_assessed_not_domain_approved",
        method: "explicit_manual_row_review",
        assessment_sha256: hash(canonical(assessment)),
        reviewer: "assistant",
        human_expert_approval: null,
      },
      family: assessment.families,
      quantity: {
        source_name: raw.name,
        interpretation_status: "requires_domain_confirmation",
      },
      applicability: {
        status: "unconfirmed",
        value: null,
        required_evidence:
          "Применимость к объекту/элементу, комплектность и сопоставимость редакций до сравнения (итоговый PDF, физическая стр. 19).",
      },
      scope: {
        status: "source_assessed",
        proposal: assessment.scope,
        approved_value: null,
      },
      sources: {
        status: "matrix_source_descriptions",
        required_stages: null,
        descriptions: stageSources,
        stage_requirement_status: "branch_specific_confirmation_required",
      },
      unit: {
        raw: raw.unit,
        canonical_unit: null,
        conversion_policy: null,
        status: "unconfirmed_normalization",
      },
      basis: {
        matrix: {
          source_path: "docs/requirements/matrix-132.xlsx",
          sheet: "МАТРИЦА",
          row: raw.matrix_row,
          trigger: raw.trigger,
          status: "source_verified",
        },
        normative: null,
        domain_approval: null,
        thresholds_executable: false,
      },
      required_facts: assessment.required_facts,
      required_branches: branches,
      support_status: {
        catalogued: true,
        manual_source_assessed: true,
        domain_approved: false,
        new_gate_passed: false,
        publishable: false,
        legacy_effective_rule_present: Boolean(effective),
        legacy_comparison_present: Boolean(effective?.comparison),
      },
      examples: Object.fromEntries(
        ["positive", "negative", "boundary", "uncertain"].map((key) => [
          key,
          {
            status: "input_required",
            fixture_hashes: [],
            expected_value: null,
            expected_unit: null,
            expected_locator: null,
            expected_verdict: null,
          },
        ]),
      ),
      current_runtime: {
        captured_at: current.captured_at,
        approved_record_count: approved.length,
        effective_rule: effective
          ? {
              id: effective.id,
              version: effective.version,
              sha256: hash(canonical(effective)),
              plan_sha256: hash(canonical(effective.plan)),
              comparison_sha256: hash(canonical(effective.comparison)),
            }
          : null,
      },
      historical_inventory: {
        captured_at: legacy.captured_at,
        version_count: historical.length,
        draft_count: historical.filter((r) => r.status === "draft").length,
        contains_only_unapproved_versions:
          historical.length > 0 &&
          !historical.some((r) => r.status === "approved"),
      },
      known_legacy_risks: risk,
      blocking_questions: [
        assessment.blocking_question,
        "Какие разрешённые положительный/отрицательный/граничный/неопределённый эталоны и их локаторы подтверждены предметным проверяющим?",
      ],
      next_action:
        "Подтвердить паспорт и источники одной строки, подготовить разрешённые fixtures, выполнить версионированную регрессию; не вызывать approve автоматически.",
    };
  });
  return {
    schema_version: 1,
    kind: "matrix_source_assessment_ledger",
    provenance,
    qualification:
      "Построчный разбор источника, не новые утверждённые паспорта БД и не полный ruleset. Исторические approvals сохранены отдельно. Ни одна норма не добавлена по догадке.",
    counts: {
      catalog_rows: records.length,
      source_assessed_rows: records.length,
      current_approved_records: current.rules.filter(
        (r) => r.status === "approved",
      ).length,
      current_effective_parameters: records.filter(
        (r) => r.current_runtime.effective_rule,
      ).length,
      current_review_counts: current.review_counts ?? null,
      domain_approved_by_this_ledger: 0,
      current_parameters_without_approved_rule: records.filter(
        (r) => !r.current_runtime.effective_rule,
      ).length,
      historical_draft_only_parameters: records.filter(
        (r) => r.historical_inventory.contains_only_unapproved_versions,
      ).length,
      historical_parameters_without_any_version: records.filter(
        (r) => r.historical_inventory.version_count === 0,
      ).length,
    },
    rows: records,
  };
}

export function renderLedger(ledger) {
  const escape = (value) =>
    String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  return (
    `# Построчный разбор Матрицы\n\n${ledger.qualification}\n\nИсточник runtime: \`${ledger.provenance.inventory_path}\`; исходная разработческая БД этим генератором не читается. Каталог: **132**; исторически исполнимых параметров на выбранном стенде: **${ledger.counts.current_effective_parameters}**; новых предметно принятых: **0**.\n\nВ [JSON](matrix-ledger.json) сохранены все девять исходных полей, полный raw, hashes, источники стадий, ветви, неизвестные основания, категории примеров и сведения о текущем/историческом правиле. Этот документ генерируется из [132 ручных разборов](row-assessments.tsv). Указанные в raw численные границы — сведения Матрицы, а не автоматически подтверждённые нормы.\n\n| Код | Параметр | Семейства | Область проверки | Нужные факты | Предметный блокер |\n|---|---|---|---|---|---|\n` +
    ledger.rows
      .map(
        (r) =>
          `| ${r.parameter_code} | ${escape(r.raw_catalog_record.name)} | ${r.family.join(", ")} | ${escape(r.scope.proposal)} | ${escape(r.required_facts)} | ${escape(r.blocking_questions[0])} |`,
      )
      .join("\n") +
    "\n\nПолная партия принимается построчно по MAT tasks 3.1–3.12. Неизвестный источник/оператор блокирует соответствующую ветвь; missing/unknown не являются нарушениями. Runtime approve и публикация этим инструментом не выполняются.\n"
  );
}

export function generate(
  inventoryPath = "docs/matrix/mat-runtime-inventory-2026-09-27.json",
) {
  const catalogPath = "backend/scripts/matrix-132.jsonl";
  const assessmentPath = "docs/matrix/row-assessments.tsv";
  const legacyPath = "docs/matrix/mat-a-legacy-inventory-2026-09-27.json";
  const catalog = read(catalogPath)
    .toString("utf8")
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  const assessments = assessmentsFrom(read(assessmentPath).toString("utf8"));
  const sources = [
    catalogPath,
    assessmentPath,
    inventoryPath,
    legacyPath,
    "docs/requirements/matrix-132.xlsx",
    "docs/requirements/matrix-legend.docx",
    "docs/requirements/10. Мосстройнадзор.pdf",
  ].map((path) => ({ path, sha256: hash(read(path)) }));
  return makeLedger(
    catalog,
    assessments,
    json(inventoryPath),
    json(legacyPath),
    {
      inventory_path: inventoryPath,
      sources,
      generator: "backend/scripts/matrix-ledger.mjs",
      generator_sha256: hash(read("backend/scripts/matrix-ledger.mjs")),
      assessment_date: "2026-09-27",
    },
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arg = process.argv.indexOf("--inventory");
  const ledger = generate(arg >= 0 ? process.argv[arg + 1] : undefined);
  const outputs = {
    "docs/matrix/matrix-ledger.json": JSON.stringify(ledger, null, 2) + "\n",
    "docs/matrix/MATRIX_LEDGER.md": renderLedger(ledger),
  };
  for (const [path, value] of Object.entries(outputs)) {
    if (process.argv.includes("--check")) {
      if (read(path).toString("utf8") !== value)
        throw new Error(`Generated output differs: ${path}`);
    } else writeFileSync(resolve(root, path), value, "utf8");
  }
  console.log(JSON.stringify(ledger.counts));
}
