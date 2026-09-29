import { nextSectionAdmission } from "./section-admission";

describe("section start admission identity", () => {
  const runId = "run-1";
  let counter = 0;
  const createId = () => `request-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  it("replays the same request after a lost response", () => {
    const first = nextSectionAdmission(null, runId, false, createId);
    // The POST outcome was uncertain — the next click must repeat request A,
    // not admit request B over a possible in-flight admission.
    const retry = nextSectionAdmission(first, runId, false, createId);
    expect(retry.request_id).toBe(first.request_id);
    expect(retry.expected_run_id).toBe(runId);
    expect(counter).toBe(1);
  });

  it("mints a fresh request for a deliberate new start or another run", () => {
    const first = nextSectionAdmission(null, runId, false, createId);
    const afterConfirm = nextSectionAdmission(first, runId, true, createId);
    expect(afterConfirm.request_id).not.toBe(first.request_id);
    const otherRun = nextSectionAdmission(first, "run-2", false, createId);
    expect(otherRun.request_id).not.toBe(first.request_id);
    expect(otherRun.expected_run_id).toBe("run-2");
  });
});
