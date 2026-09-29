import { fireEvent, render, screen } from "@testing-library/react";

import type { SectionAnalysisSnapshot } from "@/api/types/section-analysis";
import {
  sectionActualEvidence,
  sectionReferenceEvidence,
  sectionSnapshot,
} from "@/api/types/section-analysis-test-fixtures";
import type { SectionEvidenceTarget } from "../lib/evidence-navigation";
import { SectionAnalysisDetails } from "./SectionAnalysisDetails";

const fileNames = new Map([
  [sectionReferenceEvidence.file_id, "ПД-раздел-3.pdf"],
  [sectionActualEvidence.file_id, "РД-листы.pdf"],
]);

const referenceTarget: SectionEvidenceTarget = {
  fileId: sectionReferenceEvidence.file_id,
  artifactId: sectionReferenceEvidence.artifact_id,
  page: sectionReferenceEvidence.page_number,
  blockId: sectionReferenceEvidence.block_id,
  role: "reference",
  quote: sectionReferenceEvidence.quote,
  label: "ПД-раздел-3.pdf",
};
const actualTarget: SectionEvidenceTarget = {
  fileId: sectionActualEvidence.file_id,
  artifactId: sectionActualEvidence.artifact_id,
  page: sectionActualEvidence.page_number,
  blockId: sectionActualEvidence.block_id,
  role: "actual",
  quote: sectionActualEvidence.quote,
  label: "РД-листы.pdf",
};
const targets = [referenceTarget, actualTarget];

function mount(
  section: SectionAnalysisSnapshot = sectionSnapshot,
  resolvedTargets: readonly SectionEvidenceTarget[] = targets,
  onLocate?: (target: SectionEvidenceTarget) => void,
) {
  return render(
    <SectionAnalysisDetails
      fileNames={fileNames}
      onLocate={onLocate}
      section={section}
      targets={resolvedTargets}
    />,
  );
}

describe("SectionAnalysisDetails", () => {
  it("shows the preliminary fact as an orientation, not a decision", () => {
    mount();
    expect(
      screen.getByText("Предварительный результат анализа разделов"),
    ).toBeTruthy();
    expect(screen.getByText(/предварительно указывает/)).toBeTruthy();
    expect(
      screen.getByText(/В эталонном разделе указан класс В25/),
    ).toBeTruthy();
  });

  it("renders the inspector question, matrix basis and section bounds", () => {
    mount();
    expect(
      screen.getByText(/Подтверждено ли согласованное изменение класса?/),
    ).toBeTruthy();
    expect(screen.getByText(/Класс бетона несущих конструкций/)).toBeTruthy();
    expect(
      screen.getByText(/Условие применения: Для всех несущих/),
    ).toBeTruthy();
    expect(screen.getByText("3. Конструктивные решения")).toBeTruthy();
    expect(screen.getByText("3.1 Несущие конструкции")).toBeTruthy();
    expect(screen.getByText(/стр\. 3–4/)).toBeTruthy();
    expect(screen.getByText(/стр\. 5–6/)).toBeTruthy();
  });

  it("admits unknown page bounds on legacy payloads without inventing them", () => {
    mount({
      ...sectionSnapshot,
      sections: sectionSnapshot.sections.map((bound) => ({
        section_id: bound.section_id,
        source_ref: bound.source_ref,
        title: bound.title,
        start_block_id: bound.start_block_id,
        end_block_id: bound.end_block_id,
        parameter_codes: bound.parameter_codes,
      })),
    });
    expect(
      screen.getAllByText(/границы по страницам не зафиксированы/),
    ).toHaveLength(2);
  });

  it("does not leak opaque internal block identifiers", () => {
    mount();
    expect(screen.queryByText(/blk-pd-/)).toBeNull();
    expect(screen.queryByText(/blk-rd-/)).toBeNull();
  });

  it("lists both source roles with real file names", () => {
    mount();
    expect(screen.getByText("Эталонный источник · ПД")).toBeTruthy();
    expect(screen.getByText("Проверяемый источник · РД")).toBeTruthy();
    // Имя файла появляется в блоке источников, границ разделов и цитат.
    expect(screen.getAllByText(/ПД-раздел-3\.pdf/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/РД-листы\.pdf/).length).toBeGreaterThan(0);
  });

  it("routes each citation through its typed target, preserving the role", () => {
    const onLocate = vi.fn<(target: SectionEvidenceTarget) => void>();
    mount(sectionSnapshot, targets, onLocate);
    const buttons = screen.getAllByRole("button", {
      name: "Показать в документе",
    });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(onLocate).toHaveBeenCalledWith(referenceTarget);
    fireEvent.click(buttons[1]!);
    expect(onLocate).toHaveBeenCalledWith(actualTarget);
    expect(onLocate.mock.calls[0]?.[0].role).toBe("reference");
    expect(onLocate.mock.calls[1]?.[0].role).toBe("actual");
  });

  it("keeps an unresolved citation read-only instead of navigating blind", () => {
    const onLocate = vi.fn();
    mount(sectionSnapshot, [actualTarget], onLocate);
    const buttons = screen.getAllByRole("button", {
      name: "Показать в документе",
    });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText(/Класс бетона В25/)).toBeTruthy();
    fireEvent.click(buttons[0]!);
    expect(onLocate).toHaveBeenCalledWith(actualTarget);
  });

  it("shows missing context and partial coverage honestly", () => {
    mount({
      ...sectionSnapshot,
      assessment: "insufficient_context",
      fact: null,
      missing_context: ["Раздел обрезан лимитом запроса"],
      coverage: { complete: false, missing: ["block_omitted:sec-1:blk-9"] },
    });
    expect(screen.getByText(/не получил достаточного контекста/)).toBeTruthy();
    expect(screen.getByText(/Раздел обрезан лимитом запроса/)).toBeTruthy();
    expect(screen.getByText("Контекст проверен не полностью")).toBeTruthy();
    expect(screen.getByText(/Факт не получен/)).toBeTruthy();
  });

  it("translates machine coverage codes instead of printing raw ids", () => {
    mount({
      ...sectionSnapshot,
      coverage: {
        complete: false,
        missing: ["block_omitted:sec-1:blk-9"],
      },
    });
    expect(screen.queryByText(/blk-9/)).toBeNull();
    expect(
      screen.getByText(/Часть материала раздела не была проверена/),
    ).toBeTruthy();
  });
});
