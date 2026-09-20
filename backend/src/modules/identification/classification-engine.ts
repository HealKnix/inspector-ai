import { createHash } from "node:crypto";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import type { ClassificationConfig } from "./classification-config.js";
import { buildClassificationContext } from "./classification-context.js";
import {
  CLASSIFIER_VERSION,
  CONTEXT_VERSION,
  PROMPT_VERSION,
  RULES_VERSION,
  type ClassificationResult,
} from "./classification-contract.js";
import { classifyWithLlm } from "./classification-llm.js";
import { classifyByRules } from "./classification-rules.js";

export function classificationFingerprint(
  config: ClassificationConfig,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        classifier: CLASSIFIER_VERSION,
        rules: RULES_VERSION,
        context: CONTEXT_VERSION,
        prompt: PROMPT_VERSION,
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        model: config.model,
        responseFormat: config.responseFormat,
      }),
    )
    .digest("hex");
}

export async function classify(
  artifact: ParseArtifactData,
  format: string,
  config: ClassificationConfig,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  const candidates = classifyByRules(artifact, format);
  const result: ClassificationResult = {
    schema_version: 1,
    stage: null,
    document_kind: null,
    method: "none",
    needs_review: true,
    reasons: [],
    evidence: [],
    candidates,
    versions: {
      classifier: CLASSIFIER_VERSION,
      rules: RULES_VERSION,
      context: CONTEXT_VERSION,
      prompt: PROMPT_VERSION,
      model: null,
    },
  };
  const families = new Set(candidates.map((candidate) => candidate.stage));
  const kinds = new Set(
    candidates.map((candidate) => candidate.document_kind).filter(Boolean),
  );
  if (families.size > 1 || kinds.size > 1) {
    return {
      ...result,
      method: "rules",
      reasons: ["conflicting_own_evidence", "possible_mixed_document"],
      evidence: candidates
        .flatMap((candidate) => candidate.evidence)
        .slice(0, 12),
    };
  }
  if (families.size === 1) {
    const candidate = candidates[0]!;
    const partial =
      artifact.coverage.unreadable_pages > 0 || artifact.quality !== "OK";
    return {
      ...result,
      stage: candidate.stage,
      document_kind: [...kinds][0] ?? null,
      method: "rules",
      needs_review: partial,
      reasons: [
        ...new Set(candidates.flatMap((item) => item.reasons)),
        ...(partial ? ["partial_parse_requires_review"] : []),
      ],
      evidence: candidates.flatMap((item) => item.evidence).slice(0, 12),
    };
  }
  result.reasons = ["no_reliable_own_evidence"];
  if (!config.enabled)
    return { ...result, reasons: [...result.reasons, "llm_disabled"] };
  const context = buildClassificationContext(artifact);
  if (!context.fragments.length)
    return {
      ...result,
      reasons: [...result.reasons, "no_classification_fragments"],
    };
  const response = await classifyWithLlm(context, config, signal);
  return {
    ...result,
    stage: response.stage,
    document_kind: response.document_kind,
    method: "llm",
    needs_review: true,
    reasons: [
      response.stage ? "llm_requires_review" : "llm_insufficient_evidence",
      ...(context.truncated ? ["bounded_context"] : []),
    ],
    evidence: response.evidence,
    candidates: response.stage
      ? [
          {
            stage: response.stage,
            document_kind: response.document_kind,
            method: "llm",
            reasons: ["llm_requires_review"],
            evidence: response.evidence,
          },
        ]
      : [],
    versions: { ...result.versions, model: config.model },
  };
}
