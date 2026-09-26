import { findingItemSchema, type ApiFinding } from "@/api/types/verification";

import { isReviewFinding } from "./review-findings";

function finding(overrides: Partial<ApiFinding> = {}): ApiFinding {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parameter_code: "P009",
    parameter_name: "Синтетический параметр",
    scope_key: "context:1",
    status: "CLARIFICATION_REQUIRED",
    risk: null,
    reason_code: null,
    comment: null,
    decided_at: null,
    has_evidence: true,
    evidence_preview: null,
    finding_version: 1,
    gate_reasons: [],
    verdict: null,
    ...overrides,
  };
}

describe("review findings", () => {
  it.each([
    "CANDIDATE",
    "CLARIFICATION_REQUIRED",
    "MISSING_EVIDENCE",
    "NOT_COMPARABLE",
  ] as const)(
    "omits an empty %s result even when its status requests attention",
    (status) =>
      expect(isReviewFinding(finding({ status, has_evidence: false }))).toBe(
        false,
      ),
  );

  it("keeps source-backed single-sided and ambiguous questions even without a comparison verdict", () => {
    expect(isReviewFinding(finding({ verdict: null }))).toBe(true);
    expect(
      isReviewFinding(
        finding({
          status: "MISSING_EVIDENCE",
          evidence_preview: {
            file_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            role: "actual",
            value: null,
            value_raw: null,
            unit: null,
            quote: "Синтетическая неоднозначная цитата",
          },
        }),
      ),
    ).toBe(true);
  });

  it.each(["NOT_APPLICABLE", "NEGATIVE_VERIFIED"] as const)(
    "does not ask an inspector to review a machine %s result",
    (status) => expect(isReviewFinding(finding({ status }))).toBe(false),
  );

  it("does not present an unavailable rule or machine match as a question", () => {
    expect(
      isReviewFinding(finding({ gate_reasons: ["rule_not_approved"] })),
    ).toBe(false);
    expect(
      isReviewFinding(
        finding({
          verdict: {
            engine: "comparison-v1",
            status: "match",
            spec: null,
            expected: [],
            actual: [],
            pairs: [],
            warnings: [],
            evaluated_at: "2026-09-26T00:00:00Z",
          },
        }),
      ),
    ).toBe(false);
  });

  it("preserves an inspector's historical decision when its evidence cannot be restored", () => {
    expect(
      isReviewFinding(
        finding({
          status: "NEGATIVE_VERIFIED",
          decided_at: "2026-09-26T00:00:00Z",
          has_evidence: false,
        }),
      ),
    ).toBe(true);
  });

  it("defaults older API responses to no evidence rather than displaying unverified placeholders", () => {
    const legacy = { ...finding() } as Partial<ApiFinding>;
    delete legacy.has_evidence;
    delete legacy.evidence_preview;
    const parsed = findingItemSchema.parse(legacy);
    expect(parsed.has_evidence).toBe(false);
    expect(parsed.evidence_preview).toBeNull();
    expect(isReviewFinding(parsed)).toBe(false);
  });
});
