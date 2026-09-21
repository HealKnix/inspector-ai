import type {
  DocumentFact,
  Evaluation,
  ExpectedRequirement,
  LoadScenario,
  ParameterGate,
  RequirementOutcome,
  RequirementResult,
  Stage,
  StageStatus,
} from "./completeness-contract.js";

const STAGES: Stage[] = ["PD", "RD", "ID"];

interface ApplicabilityCondition {
  attr?: string;
  op?: "eq" | "nonempty" | "contains";
  value?: unknown;
  all?: ApplicabilityCondition[];
  any?: ApplicabilityCondition[];
}

/** Условие применимости требования/правила против атрибутов объекта. */
export function isApplicable(
  condition: unknown,
  attributes: Record<string, unknown>,
): boolean {
  if (!condition || typeof condition !== "object") return true;
  const node = condition as ApplicabilityCondition;
  if (node.all) return node.all.every((c) => isApplicable(c, attributes));
  if (node.any) return node.any.some((c) => isApplicable(c, attributes));
  const actual = node.attr ? attributes[node.attr] : undefined;
  switch (node.op ?? "eq") {
    case "nonempty":
      return Array.isArray(actual)
        ? actual.length > 0
        : actual !== undefined && actual !== null && actual !== false;
    case "contains":
      return Array.isArray(actual) && actual.includes(node.value);
    default:
      return actual === node.value;
  }
}

function acceptedKinds(requirement: ExpectedRequirement): Set<string> {
  const kinds = new Set([requirement.kind_code]);
  for (const code of requirement.alternatives?.any ?? []) kinds.add(code);
  return kinds;
}

// Same binary under two file ids is one logical document (D3).
function distinctDocuments(facts: DocumentFact[]): DocumentFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = fact.sha256;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evaluateRequirement(
  requirement: ExpectedRequirement,
  facts: DocumentFact[],
): RequirementResult {
  const base = {
    requirement_id: requirement.id,
    code: requirement.code,
    title: requirement.title,
    stage: requirement.stage,
    scope: requirement.scope,
    matched: [] as { file_id: string }[],
    missing_parts: [] as string[],
  };
  if (requirement.excluded)
    return { ...base, outcome: "not_applicable", reasons: ["excluded"] };

  const stageFacts = facts.filter((fact) => fact.stage === requirement.stage);
  const kinds = acceptedKinds(requirement);
  const kindMatched = distinctDocuments(
    stageFacts.filter(
      (fact) =>
        !fact.needs_review &&
        !fact.kind_ambiguous &&
        fact.kind_code !== null &&
        kinds.has(fact.kind_code),
    ),
  );
  const matched = kindMatched.map((fact) => ({ file_id: fact.file_id }));

  const reasons: string[] = [];
  const ambiguous = stageFacts.some(
    (fact) => fact.kind_ambiguous || fact.needs_review,
  );
  const unresolved = stageFacts.some((fact) => fact.kind_code === null);
  const scoped = Boolean(requirement.scope?.item ?? requirement.scope?.axes);

  let outcome: RequirementOutcome;
  const missingParts: string[] = [];

  if (scoped) {
    if (kindMatched.length > 0 || ambiguous || unresolved) {
      // Кандидат по виду есть или вид не разрешён, а область работ текущим
      // слоем ID не идентифицирована — ни исполнено, ни отсутствует (D6).
      outcome = "unverifiable";
      reasons.push("scope_unresolved");
      if (ambiguous) reasons.push("kind_needs_review");
      if (unresolved) reasons.push("kind_unresolved");
      missingParts.push(
        `область: ${requirement.scope?.item ?? requirement.scope?.axes}`,
      );
    } else {
      outcome = "missing";
      reasons.push("document_absent");
      missingParts.push(
        `область: ${requirement.scope?.item ?? requirement.scope?.axes}`,
      );
    }
  } else if (kindMatched.length >= requirement.quantity.min) {
    outcome = "fulfilled";
  } else if (kindMatched.length > 0) {
    outcome = "missing";
    reasons.push("quantity_short");
    missingParts.push(
      `не хватает ${requirement.quantity.min - kindMatched.length} экз. (требуется ${requirement.quantity.min})`,
    );
  } else if (ambiguous || unresolved) {
    // Документы стадии есть, но их вид не разрешён — нельзя ни закрыть
    // требование, ни объявить его отсутствующим.
    outcome = "unverifiable";
    if (ambiguous) reasons.push("kind_needs_review");
    if (unresolved) reasons.push("kind_unresolved");
  } else {
    outcome = "missing";
    reasons.push("document_absent");
  }
  return { ...base, matched, outcome, reasons, missing_parts: missingParts };
}

function stageStatus(results: RequirementResult[]): StageStatus | null {
  const applicable = results.filter((r) => r.outcome !== "not_applicable");
  if (applicable.length === 0) return null;
  const fulfilled = applicable.filter((r) => r.outcome === "fulfilled").length;
  const missing = applicable.filter((r) => r.outcome === "missing").length;
  const unverifiable = applicable.filter(
    (r) => r.outcome === "unverifiable",
  ).length;
  // UPLOADED — только доказанная полнота: без пропусков и без неопределённости.
  const status =
    fulfilled === applicable.length
      ? "UPLOADED"
      : fulfilled === 0 && unverifiable === 0
        ? "MISSING"
        : "PARTIAL";
  return {
    status,
    applicable: applicable.length,
    fulfilled,
    missing,
    unverifiable,
  };
}

function scenario(stages: Record<Stage, StageStatus | null>): LoadScenario {
  const uploaded = STAGES.filter(
    (stage) => stages[stage]?.status === "UPLOADED",
  );
  const key = uploaded.sort().join("+");
  if (key === "ID+PD+RD") return "FULL";
  if (key === "PD+RD") return "PD_RD_ONLY";
  if (key === "ID+PD") return "PD_ID_ONLY";
  if (key === "ID+RD") return "RD_ID_ONLY";
  return uploaded.length === 1 ? "SINGLE_ONLY" : "PARTIALLY_LOADED";
}

/**
 * Детерминированный расчёт (CO-06): одинаковые требования и снимок документов
 * дают одинаковый результат. Порядок входов нормализуется сортировкой.
 */
export function evaluate(
  requirements: ExpectedRequirement[],
  documents: DocumentFact[],
): Evaluation {
  const sorted = [...requirements].sort((a, b) => a.code.localeCompare(b.code));
  const results = sorted.map((requirement) =>
    evaluateRequirement(requirement, documents),
  );
  const stages = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      stageStatus(results.filter((r) => r.stage === stage)),
    ]),
  ) as Record<Stage, StageStatus | null>;
  return {
    stages,
    scenario: scenario(stages),
    requirements: results,
    counts: {
      applicable: results.filter((r) => r.outcome !== "not_applicable").length,
      fulfilled: results.filter((r) => r.outcome === "fulfilled").length,
      missing: results.filter((r) => r.outcome === "missing").length,
      unverifiable: results.filter((r) => r.outcome === "unverifiable").length,
      not_applicable: results.filter((r) => r.outcome === "not_applicable")
        .length,
    },
  };
}

/**
 * Gate доказательств параметра Матрицы до предметного сравнения (CO-04).
 * `relevantStages` — стадии, затронутые параметром; `evidencePresent` —
 * есть ли evidence-фрагменты по параметру в снимке.
 */
export function parameterGate(input: {
  parameterApplicable: boolean;
  relevantStages: Stage[];
  stages: Record<Stage, StageStatus | null>;
  evidencePresent: boolean;
  revisionUnresolved: boolean;
}): { gate: ParameterGate; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.parameterApplicable)
    return { gate: "NOT_APPLICABLE", reasons: ["parameter_not_applicable"] };
  const unresolved = input.relevantStages.some(
    (stage) => (input.stages[stage]?.unverifiable ?? 0) > 0,
  );
  const missing = input.relevantStages.some(
    (stage) => (input.stages[stage]?.missing ?? 0) > 0,
  );
  if (unresolved || input.revisionUnresolved) {
    if (unresolved) reasons.push("stage_unresolved");
    if (input.revisionUnresolved) reasons.push("revision_unresolved");
    return { gate: "CLARIFICATION_REQUIRED", reasons };
  }
  if (missing || !input.evidencePresent) {
    if (missing) reasons.push("required_document_missing");
    if (!input.evidencePresent) reasons.push("evidence_absent");
    return { gate: "MISSING_EVIDENCE", reasons };
  }
  return { gate: "READY", reasons: [] };
}
