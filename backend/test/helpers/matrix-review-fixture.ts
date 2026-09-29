import {
  regressionEngines,
  reviewHash,
  type PassportInput,
  type RegressionFixture,
  type ReviewRule,
  type RulePassportContent,
} from "../../src/modules/extraction/matrix-review-contract.js";
import type { ParseArtifactData } from "../../src/modules/parsing/parsing-contract.js";

export const syntheticReviewRule: ReviewRule = {
  id: "00000000-0000-4000-8000-000000000001",
  parameterCode: "P002",
  version: 1,
  plan: {
    kind: "regex",
    anchors: ["размер"],
    pattern: "размер\\s+(\\d+)\\s*м2",
    type: "number",
    unit: ["м2"],
    number_policy: {
      version: "decimal-v1",
      mode: "single",
      reject_list_marker: true,
      require_unit: true,
    },
  },
  comparison: {
    kind: "equals",
    numerical_policy: {
      version: "decimal-units-v1",
      target_unit: "m2",
      zero_expected: "not_comparable",
      allow_percent_fraction: false,
      rounding: null,
    },
  },
  applicability: null,
};
export function syntheticPassportInput(
  rowId = "00000000-0000-4000-8000-000000000002",
): PassportInput {
  return {
    schema_version: 1,
    matrix_row_id: rowId,
    quantity: "Синтетический размер, не предметное правило",
    applicability: "Только изолированный тест",
    scope: "Синтетическая область",
    sources: ["PD", "RD"],
    unit: "m2",
    rounding: null,
    branches: ["extraction", "comparison"].map((operator) => ({
      id: operator,
      operator,
      version:
        operator === "extraction"
          ? regressionEngines.extraction
          : regressionEngines.comparison,
      basis_required: false,
      basis: null,
      categories: {
        positive: null,
        negative: null,
        boundary: null,
        uncertain: null,
      },
    })),
  };
}
export function syntheticPassport(): RulePassportContent {
  return {
    ...syntheticPassportInput(),
    source: {
      import_id: "00000000-0000-4000-8000-000000000003",
      catalog_sha256: "a".repeat(64),
      origin_sha256: "b".repeat(64),
      row_sha256: "c".repeat(64),
      parameter_code: "P002",
      trigger: "Синтетический триггер",
    },
  };
}
function artifact(value: number | null): ParseArtifactData {
  const text =
    value === null
      ? "Здесь нет контрольного значения"
      : `Синтетический размер ${value} м2`;
  return {
    schema_version: 1,
    source_sha256: "a".repeat(64),
    pipeline_fingerprint: "b".repeat(64),
    versions: { parser: "synthetic" },
    raw_text: text,
    normalized_text: text,
    quality: "OK",
    reasons: [],
    coverage: { total_pages: 1, readable_pages: 1, unreadable_pages: 0 },
    pages: [
      {
        page_number: 1,
        sheet_label: null,
        width: 100,
        height: 100,
        image_key: "00000000-0000-4000-8000-000000000000",
        image_sha256: "c".repeat(64),
        quality: "OK",
        reasons: [],
        transform: {
          coordinate_space: "visible-page-normalized",
          renderer: "synthetic",
          render_width: 100,
          render_height: 100,
          media_box: [0, 0, 100, 100],
          crop_box: [0, 0, 100, 100],
          rotation: 0,
          pdf_to_visible: [1, 0, 0, 1, 0, 0],
          visible_to_pdf: [1, 0, 0, 1, 0, 0],
        },
        blocks: [
          {
            id: "block-1",
            order: 0,
            kind: "text",
            raw_text: text,
            normalized_text: text,
            bbox: [0.1, 0.1, 0.9, 0.2],
            confidence: null,
            source: "native",
            structural_path: null,
            table_id: null,
            row: null,
            column: null,
            row_span: null,
            column_span: null,
          },
        ],
      },
    ],
  };
}
function expected(
  inputId: string,
  value: number | null,
): RegressionFixture["expected"]["extractions"][number] {
  return {
    input_id: inputId,
    status: value === null ? "no_evidence" : "extracted",
    value_raw: value === null ? null : String(value),
    value: value === null ? null : String(value),
    unit: value === null ? null : "m2",
    ...(value === null
      ? {}
      : {
          numerical: {
            schema_version: 1,
            decimal: String(value),
            unit: {
              raw: "м2",
              canonical: "m2",
              dimension: "area",
              source: "value",
              evidence: [
                {
                  page_number: 1,
                  sheet_label: null,
                  block_id: "block-1",
                  table_id: null,
                  table_row: null,
                  table_column: null,
                  quote: `размер ${value} м2`,
                  bbox: [0.1, 0.1, 0.9, 0.2],
                  structural_path: null,
                },
              ],
            },
            uncertainty: null,
          },
        }),
    evidence:
      value === null
        ? []
        : [
            {
              page_number: 1,
              sheet_label: null,
              block_id: "block-1",
              table_id: null,
              table_row: null,
              table_column: null,
              quote: String(value),
              bbox: [0.1, 0.1, 0.9, 0.2],
              structural_path: null,
            },
          ],
  };
}
export function syntheticRegressionFixtures(): RegressionFixture[] {
  return ["extraction", "comparison"].flatMap((branch) =>
    (["positive", "negative", "boundary", "uncertain"] as const).map(
      (category) => {
        const values =
          branch === "extraction"
            ? [
                category === "negative" || category === "uncertain"
                  ? null
                  : category === "boundary"
                    ? 0
                    : 10,
              ]
            : [
                10,
                category === "uncertain"
                  ? null
                  : category === "positive"
                    ? 11
                    : 10,
              ];
        const inputs = values.map((value, index) => {
          const data = artifact(value);
          return {
            id: `input-${index}`,
            role: index === 0 ? ("expected" as const) : ("actual" as const),
            artifact_sha256: reviewHash(data),
            artifact: data,
          };
        });
        return {
          id: `${branch}-${category}`,
          branch_id: branch,
          category,
          provenance: {
            kind: "synthetic",
            reference: "Ручной синтетический эталон MAT-A; не реальный корпус",
            permission: null,
          },
          inputs,
          expected: {
            extractions: values.map((value, index) =>
              expected(`input-${index}`, value),
            ),
            verdict:
              branch === "extraction"
                ? null
                : category === "uncertain"
                  ? "actual_missing"
                  : category === "positive"
                    ? "discrepancy"
                    : "match",
          },
        };
      },
    ),
  );
}
