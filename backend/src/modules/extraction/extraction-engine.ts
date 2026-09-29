import { createHash } from "node:crypto";
import { analysisBlocks } from "../parsing/analysis-blocks.js";
import type {
  ParseArtifactData,
  ParseBlock,
} from "../parsing/parsing-contract.js";
import {
  blockMatches,
  blockText,
  findAnchorHits,
  locatorFor,
  normalizeTerm,
  tableCandidates,
  type TableGrid,
} from "./block-search.js";
import {
  COMPARISON_ENGINE_VERSION,
  type ComparisonSpec,
} from "./comparison-contract.js";
import { normalizeDecimalInput } from "./exact-decimal.js";
import {
  EXTRACTION_ENGINE_VERSION,
  type EvidenceLocator,
  type ExtractionAlternative,
  type ExtractionOutcome,
  type ExtractionPlan,
  type RegexPlan,
  type TableLookupPlan,
} from "./extraction-contract.js";
import {
  unitDefinition,
  type NumberPolicy,
  type NumericalEvidence,
} from "./numerical-policy.js";

export interface ApprovedRule {
  parameter_code: string;
  rule_version_id: string;
  version: number;
  plan: ExtractionPlan;
  comparison: ComparisonSpec | null;
}

/** Approved ruleset + engine versions: a new approved version starts a new cycle. */
export function rulesetFingerprint(rules: ApprovedRule[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        engine: EXTRACTION_ENGINE_VERSION,
        comparison_engine: COMPARISON_ENGINE_VERSION,
        rules: rules
          .map((rule) => `${rule.rule_version_id}:${rule.version}`)
          .sort(),
      }),
    )
    .digest("hex");
}

const UNIT_ALIASES: Record<string, string> = {
  "м²": "m2",
  м2: "m2",
  "кв.м": "m2",
  "кв. м": "m2",
  "кв м": "m2",
  m2: "m2",
  "m²": "m2",
  "м³": "m3",
  м3: "m3",
  "куб.м": "m3",
  "куб. м": "m3",
  m3: "m3",
  "m³": "m3",
  м: "m",
  "п.м": "m",
  "пог.м": "m",
  "пог. м": "m",
  m: "m",
  км: "km",
  шт: "pcs",
  "шт.": "pcs",
  ед: "pcs",
  "ед.": "pcs",
  кв: "kV",
  кВ: "kV",
};

export function normalizeUnit(token: string | null): string | null {
  if (!token) return null;
  const key = normalizeTerm(token).replace(/\s+/g, " ");
  return UNIT_ALIASES[key] ?? UNIT_ALIASES[key.replace(/\s/g, "")] ?? key;
}

/** First numeric token: "4 850,5", "4850.5", "1 234 м2" → number. */
export function extractNumber(
  text: string,
): { raw: string; value: number } | null {
  const match = /-?\d[\d\s\u00A0\u202F]*(?:[.,]\d+)?/.exec(text) ?? null;
  if (!match) return null;
  const raw = match[0];
  const normalized = raw.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? { raw, value } : null;
}

function unitInText(text: string, accepted: string[] | undefined) {
  const normalized = normalizeTerm(text);
  for (const unit of accepted ?? []) {
    if (normalized.includes(normalizeTerm(unit))) return normalizeUnit(unit);
  }
  return null;
}

interface FoundValue {
  numerical?: NumericalEvidence;
  value_raw: string;
  value: number | string;
  unit: string | null;
  evidence: EvidenceLocator[];
}

function typedValue(
  text: string,
  spec: { type?: "number" | "text" | "enum"; enum?: string[]; unit?: string[] },
  context: string,
): { value: number | string; unit: string | null } | null {
  const unit = unitInText(`${text} ${context}`, spec.unit);
  const type = spec.type ?? "number";
  if (type === "number") {
    const parsed = extractNumber(text);
    if (!parsed) return null;
    return { value: parsed.value, unit };
  }
  if (type === "enum") {
    const normalized = normalizeTerm(text);
    const member = (spec.enum ?? []).find(
      (item) =>
        normalizeTerm(item) === normalized ||
        normalized.includes(normalizeTerm(item)),
    );
    if (!member) return null;
    return { value: member, unit };
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { value: trimmed, unit };
}

/** A strict plan owns the captured value and located unit. Nearby numbers and
 * unrelated units cannot silently supply either part of a measured fact. */
function strictNumber(
  text: string,
  policy: NumberPolicy,
  accepted: string[] | undefined,
  sources: {
    text: string;
    source: "value" | "row" | "header";
    locator: EvidenceLocator;
  }[],
): {
  value: number | string;
  unit: string | null;
  numerical: NumericalEvidence;
} | null {
  if (policy.reject_list_marker && /^\s*\d+[.)](?:\s|$)/u.test(text))
    return null;
  const tokens = [
    ...text.matchAll(
      /(?<![\p{L}\p{N}_.,])[+−-]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?(?![\p{L}\p{N}_.,])/gu,
    ),
  ];
  if (!tokens.length || (policy.mode === "single" && tokens.length !== 1))
    return null;
  const point = normalizeDecimalInput(tokens[0]![0]);
  if (point === null) return null;
  const located: NumericalEvidence["unit"][] = [];
  for (const source of sources) {
    for (const raw of accepted ?? []) {
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        !new RegExp(
          `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
          "iu",
        ).test(source.text)
      )
        continue;
      const definition = unitDefinition(raw);
      if (definition)
        located.push({
          raw,
          canonical: definition.canonical,
          dimension: definition.dimension,
          source: source.source,
          evidence: [source.locator],
        });
    }
    if (located.length) break;
  }
  if (new Set(located.map((u) => u.canonical)).size > 1) return null;
  const unit = located[0] ?? {
    raw: null,
    canonical: null,
    dimension: null,
    source: "missing" as const,
    evidence: [],
  };
  if (policy.require_unit && unit.source === "missing") return null;
  const numerical: NumericalEvidence = {
    schema_version: 1,
    decimal: point,
    unit,
    uncertainty: null,
  };
  return { value: point, unit: unit.canonical, numerical };
}

function collect(values: FoundValue[], rule: ApprovedRule): ExtractionOutcome {
  const base = {
    schema_version: 1 as const,
    parameter_code: rule.parameter_code,
    rule_version_id: rule.rule_version_id,
  };
  // Missing unit is not a disagreement: a unitless hit merges into the
  // same-valued bucket (adopting its unit); genuinely different units stay
  // distinct.
  const distinct = new Map<string, FoundValue[]>();
  for (const found of values) {
    if (found.numerical) {
      const key = `exact:${found.numerical.decimal}:${found.unit ?? "missing"}`;
      const list = distinct.get(key) ?? [];
      list.push(found);
      distinct.set(key, list);
      continue;
    }
    const valueKey = `${typeof found.value}:${String(found.value)}`;
    let target: string | null = null;
    for (const key of distinct.keys()) {
      if (!key.startsWith(`${valueKey}:`)) continue;
      const unit = key.slice(valueKey.length + 1);
      if (unit === (found.unit ?? "") || unit === "" || !found.unit) {
        target = key;
        break;
      }
    }
    const list = (target && distinct.get(target)) || [];
    list.push(found);
    if (target) distinct.delete(target);
    const unit = target?.slice(valueKey.length + 1) || found.unit || "";
    if (unit) for (const item of list) item.unit ??= unit;
    distinct.set(`${valueKey}:${unit}`, list);
  }
  if (distinct.size === 0)
    return {
      ...base,
      status: "no_evidence",
      value_raw: null,
      value: null,
      unit: null,
      alternatives: null,
      reason: "value_not_found",
      evidence: [],
    };
  if (distinct.size === 1) {
    const group = [...distinct.values()][0]!;
    const first = group[0]!;
    return {
      ...base,
      status: "extracted",
      value_raw: first.value_raw,
      value: first.value,
      unit: first.unit,
      ...(first.numerical ? { numerical: first.numerical } : {}),
      alternatives: null,
      reason: null,
      evidence: group.flatMap((item) => item.evidence),
    };
  }
  const alternatives: ExtractionAlternative[] = [...distinct.entries()].map(
    ([, group]) => {
      const first = group[0]!;
      return {
        value_raw: first.value_raw,
        value: first.value,
        unit: first.unit,
        ...(first.numerical ? { numerical: first.numerical } : {}),
        evidence: group.flatMap((item) => item.evidence),
      };
    },
  );
  return {
    ...base,
    status: "ambiguous",
    value_raw: null,
    value: null,
    unit: null,
    alternatives,
    reason: "multiple_distinct_values",
    evidence: alternatives.flatMap((item) => item.evidence),
  };
}

function rowMatches(cells: ParseBlock[], anchors: string[]): boolean {
  if (
    cells.some((cell) => anchors.some((anchor) => blockMatches(cell, anchor)))
  )
    return true;
  const joined = normalizeTerm(cells.map((cell) => blockText(cell)).join(" "));
  return anchors.some((anchor) => joined.includes(normalizeTerm(anchor)));
}

function valueCell(
  grid: TableGrid,
  rowCells: ParseBlock[],
  spec: TableLookupPlan["value"],
): ParseBlock | null {
  const covered = (cell: ParseBlock, column: number) =>
    cell.column !== null &&
    column >= cell.column &&
    column < cell.column + (cell.column_span ?? 1);
  if (spec.header?.length) {
    const headerRow = Math.min(...grid.rows.keys());
    const headerCells = grid.rows.get(headerRow) ?? [];
    const headerCell = headerCells.find((cell) =>
      spec.header!.some((term) => blockMatches(cell, term)),
    );
    if (headerCell?.column === null || headerCell?.column === undefined)
      return null;
    return rowCells.find((cell) => covered(cell, headerCell.column!)) ?? null;
  }
  const column = spec.column;
  if (typeof column === "number")
    return rowCells.find((cell) => covered(cell, column)) ?? null;
  // Default: rightmost numeric cell in the matched row.
  const numeric = rowCells.filter(
    (cell) => extractNumber(blockText(cell)) !== null,
  );
  return numeric.sort((a, b) => (b.column ?? 0) - (a.column ?? 0))[0] ?? null;
}

function runTableLookup(
  artifact: ParseArtifactData,
  plan: TableLookupPlan,
): { values: FoundValue[]; searched: number } {
  const candidates = tableCandidates(artifact, plan.signature);
  const values: FoundValue[] = [];
  for (const { grid } of candidates) {
    for (const [row, cells] of [...grid.rows.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const labels = [...cells, ...(grid.rowLabels.get(row) ?? [])];
      if (!rowMatches(labels, plan.row.anchors)) continue;
      const target = valueCell(grid, cells, plan.value);
      if (!target) continue;
      const label = labels.find((cell) =>
        plan.row.anchors.some((anchor) => blockMatches(cell, anchor)),
      );
      const headerCells = grid.rows.get(Math.min(...grid.rows.keys())) ?? [];
      const numericalSources = [
        {
          text: blockText(target),
          source: "value" as const,
          locator: locatorFor(target, grid.page),
        },
        ...labels
          .filter((cell) => cell !== target)
          .map((cell) => ({
            text: blockText(cell),
            source: "row" as const,
            locator: locatorFor(cell, grid.page),
          })),
        ...headerCells
          .filter((cell) => cell.column === target.column)
          .map((cell) => ({
            text: blockText(cell),
            source: "header" as const,
            locator: locatorFor(cell, grid.page),
          })),
      ];
      const parsed = plan.value.number_policy
        ? strictNumber(
            blockText(target),
            plan.value.number_policy,
            plan.value.unit,
            numericalSources,
          )
        : typedValue(
            blockText(target),
            plan.value,
            labels.map((cell) => blockText(cell)).join(" "),
          );
      if (!parsed) continue;
      const evidence = [label, target]
        .filter((block): block is ParseBlock => Boolean(block))
        .map((block) => locatorFor(block, grid.page));
      values.push({
        value_raw: blockText(target),
        value: parsed.value,
        unit: parsed.unit,
        ...("numerical" in parsed
          ? { numerical: parsed.numerical as NumericalEvidence }
          : {}),
        evidence,
      });
    }
  }
  return { values, searched: candidates.length };
}

function runRegex(
  artifact: ParseArtifactData,
  plan: RegexPlan,
): { values: FoundValue[]; searched: number } {
  const hits = findAnchorHits(artifact, plan.anchors);
  const pattern = new RegExp(plan.pattern, plan.number_policy ? "giu" : "iu");
  const values: FoundValue[] = [];
  const window = plan.window_blocks ?? 0;
  for (const hit of hits) {
    const blocks = analysisBlocks(hit.page);
    const index = blocks.indexOf(hit.block);
    const selectedBlocks =
      window > 0 && hit.block.table_link?.status !== "ambiguous"
        ? blocks.slice(index, index + 1 + window)
        : [hit.block];
    const scope = selectedBlocks.map(blockText).join(" ");
    const matches = plan.number_policy
      ? [...scope.matchAll(pattern)]
      : [pattern.exec(scope)].filter((value) => value !== null);
    for (const match of matches) {
      const raw = (match[1] ?? match[0]).trim();
      if (!raw) continue;
      let offset = 0;
      const ownSources = selectedBlocks.flatMap((block) => {
        const text = blockText(block),
          start = Math.max(0, match.index - offset);
        const end = Math.min(
          text.length,
          match.index + match[0].length - offset,
        );
        offset += text.length + 1;
        return end > start
          ? [
              {
                text: text.slice(start, end),
                source: "value" as const,
                locator: locatorFor(block, hit.page, text.slice(start, end)),
              },
            ]
          : [];
      });
      const parsed = plan.number_policy
        ? strictNumber(raw, plan.number_policy, plan.unit, ownSources)
        : typedValue(raw, plan, scope);
      if (!parsed) continue;
      values.push({
        value_raw: raw,
        value: parsed.value,
        unit: parsed.unit,
        ...("numerical" in parsed
          ? { numerical: parsed.numerical as NumericalEvidence }
          : {}),
        evidence:
          plan.number_policy && ownSources.length > 1
            ? ownSources.map((source) => source.locator)
            : [
                locatorFor(
                  ownSources.length === 1 && plan.number_policy
                    ? selectedBlocks.find(
                        (block) => block.id === ownSources[0]!.locator.block_id,
                      )!
                    : hit.block,
                  hit.page,
                  raw,
                ),
              ],
      });
    }
  }
  return { values, searched: hits.length };
}

export function executePlan(
  artifact: ParseArtifactData,
  plan: ExtractionPlan,
  rule: ApprovedRule,
): ExtractionOutcome {
  if (artifact.coverage.readable_pages === 0)
    return {
      schema_version: 1,
      parameter_code: rule.parameter_code,
      rule_version_id: rule.rule_version_id,
      status: "unreadable",
      value_raw: null,
      value: null,
      unit: null,
      alternatives: null,
      reason: "artifact_unreadable",
      evidence: [],
    };
  if (plan.kind === "table_lookup")
    return collect(runTableLookup(artifact, plan).values, rule);
  if (plan.kind === "regex")
    return collect(runRegex(artifact, plan).values, rule);
  // cascade: first decisive step wins; collect reasons otherwise.
  const reasons: string[] = [];
  for (const step of plan.steps) {
    const { values } =
      step.kind === "table_lookup"
        ? runTableLookup(artifact, step)
        : runRegex(artifact, step);
    const outcome = collect(values, rule);
    if (outcome.status !== "no_evidence") return outcome;
    reasons.push(step.kind);
  }
  return {
    schema_version: 1,
    parameter_code: rule.parameter_code,
    rule_version_id: rule.rule_version_id,
    status: "no_evidence",
    value_raw: null,
    value: null,
    unit: null,
    alternatives: null,
    reason: `cascade_exhausted:${reasons.join(",")}`,
    evidence: [],
  };
}

export function executeArtifact(
  artifact: ParseArtifactData,
  rules: ApprovedRule[],
): ExtractionOutcome[] {
  return rules.map((rule) => {
    try {
      return executePlan(artifact, rule.plan, rule);
    } catch {
      return {
        schema_version: 1,
        parameter_code: rule.parameter_code,
        rule_version_id: rule.rule_version_id,
        status: "unsupported",
        value_raw: null,
        value: null,
        unit: null,
        alternatives: null,
        reason: "plan_execution_failed",
        evidence: [],
      } satisfies ExtractionOutcome;
    }
  });
}
