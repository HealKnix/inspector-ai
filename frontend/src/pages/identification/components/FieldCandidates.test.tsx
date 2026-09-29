import { identificationRevisionSchema } from "@/api/types/identification";
import { fireEvent, render, screen } from "@testing-library/react";
import { idRegistry } from "../lib/identification-test-fixtures";
import { reviewFields } from "../lib/review-card";
import { FieldCandidates } from "./FieldCandidates";

it("preserves PAR limitations through API decoding and opens the exact candidate source", () => {
  const input = structuredClone(idRegistry.documents[0]!.revisions[0]!);
  const candidate = input.candidates[0]!;
  candidate.field = "observed_replaced_sheet";
  candidate.role = "observed";
  candidate.raw = candidate.normalized = "4";
  candidate.evidence[0]!.parse_context = {
    source: "native",
    native_valid: true,
    include_in_main: false,
    region_id: "unknown-region",
    region_kind: "unknown",
    region_method: "skipped",
    text_status: "selected",
    reasons: ["LAYOUT_BOUNDARY_CONFLICT"],
  };
  const revision = identificationRevisionSchema.parse(input);
  const onEvidence = vi.fn();
  render(<FieldCandidates revision={revision} onEvidence={onEvidence} />);
  expect(
    screen.getByText(/Структура фрагмента требует проверки/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Лист в перечне замены/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Открыть источник/ }));
  expect(onEvidence).toHaveBeenCalledWith(candidate.evidence[0]);
  expect(reviewFields(revision)).not.toContain("observed_replaced_sheet");
});

it("reads historical evidence without inventing PAR routing or limitations", () => {
  const revision = identificationRevisionSchema.parse(
    idRegistry.documents[0]!.revisions[0],
  );
  render(<FieldCandidates revision={revision} onEvidence={vi.fn()} />);
  expect(revision.candidates[0]!.evidence[0]!.parse_context).toBeUndefined();
  expect(
    screen.queryByText(/Структура фрагмента требует проверки/),
  ).not.toBeInTheDocument();
});
