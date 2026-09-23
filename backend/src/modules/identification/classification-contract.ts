import type { ParseBlock } from "../parsing/parsing-contract.js";

export type ClassificationStage = "PD" | "RD" | "ID";
export interface ClassificationEvidence {
  page_number: number;
  block_id: string;
  quote: string;
  bbox: ParseBlock["bbox"];
  structural_path: string | null;
}
export interface ClassificationCandidate {
  stage: ClassificationStage;
  document_kind: string | null;
  method: "rules" | "llm";
  evidence: ClassificationEvidence[];
  reasons: string[];
}
export interface ClassificationResult {
  schema_version: 1;
  stage: ClassificationStage | null;
  document_kind: string | null;
  /** Код вида из словаря каркаса; заполняется при ручном разрешении инспектором. */
  kind_code?: string | null;
  method: "rules" | "llm" | "none" | "manual";
  needs_review: boolean;
  reasons: string[];
  evidence: ClassificationEvidence[];
  candidates: ClassificationCandidate[];
  versions: {
    classifier: string;
    rules: string;
    context: string;
    prompt: string;
    model: string | null;
  };
}

export const CLASSIFIER_VERSION = "classification-v1";
export const RULES_VERSION = "own-evidence-v2";
export const CONTEXT_VERSION = "title-anchors-v1";
export const PROMPT_VERSION = "document-family-v1";

export class ClassificationError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
