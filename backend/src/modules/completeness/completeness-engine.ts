import type {
  IdentificationField,
  IdentificationSnapshot,
} from "../identification/identification-contract.js";
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
import { normalizeItemKey } from "./completeness-extract.js";

const STAGES: Stage[] = ["PD", "RD", "ID"];

/** Whole logical documents from this immutable selection, never live classifier heads. */
export function documentFactsFromSnapshot(
  snapshot: IdentificationSnapshot,
): DocumentFact[] {
  return snapshot.documents.flatMap((document) => {
    const selected = new Set(
      snapshot.contexts
        .filter(
          (context) =>
            context.status === "READY" &&
            context.reference?.document_id === document.document_id,
        )
        .map((context) => context.reference!.revision_id),
    );
    const revisions = selected.size
      ? document.revisions.filter((revision) =>
          selected.has(revision.revision_id),
        )
      : document.revisions;
    const representations = revisions
      .flatMap((revision) => revision.representations)
      .sort((a, b) => a.file_id.localeCompare(b.file_id));
    const first = representations[0];
    if (!first) return [];
    const stages = new Set(
      revisions
        .map((revision) => revision.fields.stage)
        .filter((stage): stage is Stage => STAGES.includes(stage as Stage)),
    );
    const kinds = new Set(
      revisions
        .map((revision) => revision.fields.kind_code)
        .filter((kind): kind is string => Boolean(kind)),
    );
    const blocked = revisions.some((revision) =>
      revision.blockers.some(
        (blocker) =>
          !blocker.startsWith("field_conflict:") ||
          !revision.fields[
            blocker.slice("field_conflict:".length) as IdentificationField
          ],
      ),
    );
    const needsReview =
      blocked ||
      (!selected.size && revisions.length !== 1) ||
      revisions.some(
        (revision) =>
          !STAGES.includes(revision.fields.stage as Stage) ||
          !revision.fields.kind_code,
      ) ||
      stages.size !== 1 ||
      kinds.size !== 1;
    const covered = new Set<string>();
    if (!needsReview)
      for (const revision of revisions) {
        // A mention of a work item in arbitrary document text is no longer proof.
        if (
          revision.approval.confirmed &&
          revision.approval.basis?.trim() &&
          revision.fields.scope?.trim()
        )
          covered.add(normalizeItemKey(revision.fields.scope));
      }
    return [
      {
        document_id: document.document_id,
        revision_ids: revisions.map((revision) => revision.revision_id).sort(),
        file_id: first.file_id,
        sha256: first.source_sha256,
        stage: stages.size === 1 ? [...stages][0]! : null,
        kind_code: kinds.size === 1 ? [...kinds][0]! : null,
        kind_ambiguous: kinds.size > 1,
        needs_review: needsReview,
        covered_items: [...covered].sort(),
      },
    ];
  });
}

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

// New facts are deduplicated by logical identity. SHA is legacy-only fallback.
function distinctDocuments(facts: DocumentFact[]): DocumentFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = fact.document_id
      ? `document:${fact.document_id}`
      : `sha256:${fact.sha256}`;
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
    matched: [] as RequirementResult["matched"],
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

  const reasons: string[] = [];
  const ambiguous = stageFacts.some(
    (fact) => fact.kind_ambiguous || fact.needs_review,
  );
  const unresolved = stageFacts.some((fact) => fact.kind_code === null);
  const scopedItem = requirement.scope?.item ?? requirement.scope?.axes;
  const scoped = Boolean(scopedItem);

  let outcome: RequirementOutcome;
  const sourceRef = (fact: DocumentFact) => ({
    file_id: fact.file_id,
    ...(fact.document_id ? { document_id: fact.document_id } : {}),
    ...(fact.revision_ids ? { revision_ids: fact.revision_ids } : {}),
  });
  let matched = kindMatched.map(sourceRef);
  const missingParts: string[] = [];

  if (scoped) {
    // Подтверждённая собственная область выбранной редакции должна точно
    // совпасть с пунктом; произвольное упоминание в тексте не является связью.
    const itemKey = scopedItem ? normalizeItemKey(scopedItem) : null;
    const covering = itemKey
      ? kindMatched.filter((fact) => fact.covered_items.includes(itemKey))
      : [];
    if (covering.length >= requirement.quantity.min) {
      outcome = "fulfilled";
      matched = covering.map(sourceRef);
    } else if (kindMatched.length > 0 || ambiguous || unresolved) {
      // Кандидат по виду есть, но покрытие пункта не доказано — ни исполнено,
      // ни отсутствует (D6).
      outcome = "unverifiable";
      reasons.push("scope_unresolved");
      if (ambiguous) reasons.push("kind_needs_review");
      if (unresolved) reasons.push("kind_unresolved");
      missingParts.push(`область: ${scopedItem}`);
    } else {
      outcome = "missing";
      reasons.push("document_absent");
      missingParts.push(`область: ${scopedItem}`);
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
  const reasons: Record<string, number> = {};
  let fulfilledRequired = 0;
  for (const [index, result] of results.entries()) {
    if (
      result.outcome === "fulfilled" &&
      (sorted[index]?.quantity.min ?? 1) >= 1
    )
      fulfilledRequired += 1;
    for (const reason of result.reasons)
      reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return {
    stages,
    scenario: scenario(stages),
    requirements: results,
    counts: {
      applicable: results.filter((r) => r.outcome !== "not_applicable").length,
      fulfilled: results.filter((r) => r.outcome === "fulfilled").length,
      fulfilled_required: fulfilledRequired,
      missing: results.filter((r) => r.outcome === "missing").length,
      unverifiable: results.filter((r) => r.outcome === "unverifiable").length,
      not_applicable: results.filter((r) => r.outcome === "not_applicable")
        .length,
      reasons,
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
