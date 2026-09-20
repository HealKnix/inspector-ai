import { createHash } from "node:crypto";
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
  EXTRACTION_ENGINE_VERSION,
  type EvidenceLocator,
  type ExtractionAlternative,
  type ExtractionOutcome,
  type ExtractionPlan,
  type RegexPlan,
  type TableLookupPlan,
} from "./extraction-contract.js";

export interface ApprovedRule {
  parameter_code: string;
  rule_version_id: string;
  version: number;
  plan: ExtractionPlan;
}

/** Approved ruleset + engine version: a new approved version starts a new cycle. */
export function rulesetFingerprint(rules: ApprovedRule[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        engine: EXTRACTION_ENGINE_VERSION,
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

function collect(values: FoundValue[], rule: ApprovedRule): ExtractionOutcome {
  const base = {
    schema_version: 1 as const,
    parameter_code: rule.parameter_code,
    rule_version_id: rule.rule_version_id,
  };
  const distinct = new Map<string, FoundValue[]>();
  for (const found of values) {
    const key = `${typeof found.value}:${String(found.value)}:${found.unit ?? ""}`;
    const list = distinct.get(key) ?? [];
    list.push(found);
    distinct.set(key, list);
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
    for (const [, cells] of [...grid.rows.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (!rowMatches(cells, plan.row.anchors)) continue;
      const target = valueCell(grid, cells, plan.value);
      if (!target) continue;
      const label = cells.find((cell) =>
        plan.row.anchors.some((anchor) => blockMatches(cell, anchor)),
      );
      const parsed = typedValue(
        blockText(target),
        plan.value,
        cells.map((cell) => blockText(cell)).join(" "),
      );
      if (!parsed) continue;
      const evidence = [label, target]
        .filter((block): block is ParseBlock => Boolean(block))
        .map((block) => locatorFor(block, grid.page));
      values.push({
        value_raw: blockText(target),
        value: parsed.value,
        unit: parsed.unit,
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
  const pattern = new RegExp(plan.pattern, "iu");
  const values: FoundValue[] = [];
  const window = plan.window_blocks ?? 0;
  for (const hit of hits) {
    const index = hit.page.blocks.indexOf(hit.block);
    const scope =
      window > 0
        ? hit.page.blocks
            .slice(index, index + 1 + window)
            .map((block) => blockText(block))
            .join(" ")
        : blockText(hit.block);
    const match = pattern.exec(scope);
    if (!match) continue;
    const raw = (match[1] ?? match[0]).trim();
    if (!raw) continue;
    const parsed = typedValue(raw, plan, scope);
    if (!parsed) continue;
    values.push({
      value_raw: raw,
      value: parsed.value,
      unit: parsed.unit,
      evidence: [locatorFor(hit.block, hit.page, raw)],
    });
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
