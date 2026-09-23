// Contract v1 for the completeness domain (design D1–D6). Facts come from
// ID/EXT/GEO layers; evaluation output is deterministic for a given input.

export type Stage = "PD" | "RD" | "ID";

export interface RequirementQuantity {
  min: number;
  /** list_kind, по которому требование развёрнуто; null — одно на объект */
  per: string | null;
}

export interface RequirementAlternatives {
  /** OR-группа допустимых kind_code вместо основного */
  any?: string[];
}

export interface ExpectedRequirement {
  id: string;
  code: string;
  stage: Stage;
  kind_code: string;
  title: string;
  scope: { item?: string; axes?: string } | null;
  quantity: RequirementQuantity;
  alternatives: RequirementAlternatives | null;
  excluded: boolean;
}

/** Один логический документ снимка (представления слиты на входе). */
export interface DocumentFact {
  file_id: string;
  sha256: string;
  stage: Stage | null;
  /** kind_code из словаря каркаса; null — вид не разрешён */
  kind_code: string | null;
  /** вид разрешён неоднозначно (несколько кодов) */
  kind_ambiguous: boolean;
  needs_review: boolean;
  /** Нормализованные пункты объектного перечня, упомянутые в тексте документа. */
  covered_items: string[];
}

export type RequirementOutcome =
  "fulfilled" | "missing" | "not_applicable" | "unverifiable";

export interface RequirementResult {
  requirement_id: string;
  code: string;
  title: string;
  stage: Stage;
  scope: ExpectedRequirement["scope"];
  outcome: RequirementOutcome;
  reasons: string[];
  matched: { file_id: string }[];
  missing_parts: string[];
}

export type StageStatusValue = "UPLOADED" | "PARTIAL" | "MISSING";

export interface StageStatus {
  status: StageStatusValue;
  applicable: number;
  fulfilled: number;
  missing: number;
  unverifiable: number;
}

export type LoadScenario =
  | "FULL"
  | "PD_RD_ONLY"
  | "PD_ID_ONLY"
  | "RD_ID_ONLY"
  | "SINGLE_ONLY"
  | "PARTIALLY_LOADED";

export interface Evaluation {
  stages: Record<Stage, StageStatus | null>;
  scenario: LoadScenario;
  requirements: RequirementResult[];
  counts: {
    applicable: number;
    fulfilled: number;
    /** fulfilled среди требований с quantity.min >= 1 (нетривиальных). */
    fulfilled_required: number;
    missing: number;
    unverifiable: number;
    not_applicable: number;
    /** Агрегированные причины по всем требованиям (reason → число требований). */
    reasons: Record<string, number>;
  };
}

export type ParameterGate =
  | "NOT_APPLICABLE"
  | "MISSING_EVIDENCE"
  | "NOT_COMPARABLE"
  | "CLARIFICATION_REQUIRED"
  | "READY";
