import { compositeTraceFixture } from "@/api/types/composite-comparison-test-fixtures";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ComparisonBasis } from "./ComparisonBasis";
import { ComparisonTrace } from "./ComparisonTrace";

afterEach(cleanup);

it("shows the basis frozen with the finding and invents none for history", () => {
  const { rerender, container } = render(<ComparisonBasis />);
  expect(container).toBeEmptyDOMElement();
  rerender(
    <ComparisonBasis
      basis={{
        content: {
          quantity: "Синтетический размер",
          scope: "Этаж 2",
          applicability: "Тестовый случай",
          source: { trigger: "Исходный синтетический триггер" },
          branches: [
            {
              id: "comparison",
              basis: {
                reference: "Синтетическое основание",
                version: "v1",
                locator: "п. 2",
              },
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByText(/Условие матрицы/)).toHaveTextContent(
    "Исходный синтетический триггер",
  );
  expect(screen.getByText(/Синтетическое основание/)).toHaveTextContent(
    "редакция v1; п. 2",
  );
});

it("keeps the legacy response without an invented calculation trace", () => {
  const { container } = render(<ComparisonTrace />);
  expect(container).toBeEmptyDOMElement();
});
it("shows exact digits, source units and their page without formatting through a float", () => {
  render(
    <ComparisonTrace
      trace={{
        kind: "numerical",
        policy: { target_unit: "m", rounding: null },
        actual: {
          raw: "9007199254740993 мм",
          decimal: "9007199254740993",
          converted: "9007199254740.993",
          rounded: "9007199254740.993",
          source_unit: {
            canonical: "mm",
            evidence: [{ page_number: 4, quote: "Размеры в мм" }],
          },
          conversion: { factor: "0.001" },
          interval: { lower: "9007199254740.993", upper: "9007199254740.993" },
        },
        delta: "0.00000000000000000001",
        reason: null,
      }}
    />,
  );
  expect(screen.getByText(/Точное значение:/)).toHaveTextContent(
    "9007199254740993 mm → 9007199254740.993 m",
  );
  expect(screen.getByText(/Единица в источнике/)).toHaveTextContent(
    "стр. 4: «Размеры в мм»",
  );
  expect(screen.getByText(/Точная разность/)).toHaveTextContent(
    "0.00000000000000000001",
  );
});
it("explains missing units separately from a discrepancy", () => {
  render(
    <ComparisonTrace
      trace={{
        kind: "numerical",
        reason: "unit_missing",
        policy: { rounding: null },
      }}
    />,
  );
  expect(screen.getByText(/Причина неопределённости/)).toHaveTextContent(
    "В документе не подтверждена единица измерения.",
  );
  expect(screen.queryByText(/unit_missing/)).not.toBeInTheDocument();
});

it("shows the determining OR branch and retains the unknown alternative", () => {
  render(<ComparisonTrace composite={compositeTraceFixture()} />);
  expect(
    screen.getByText("Составное условие · Условие выполнено"),
  ).toBeInTheDocument();
  const known = within(screen.getByRole("region", { name: "Ветвь known" }));
  const unresolved = within(
    screen.getByRole("region", { name: "Ветвь unresolved" }),
  );
  expect(known.getByText(/Определяет результат/)).toBeInTheDocument();
  expect(
    unresolved.queryByText(/Определяет результат/),
  ).not.toBeInTheDocument();
  expect(
    unresolved.getByText("Недостаточно данных для вывода"),
  ).toBeInTheDocument();
  expect(
    unresolved.getByText(
      "Нет подтверждённого значения в проверяемом документе.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/scalar_actual_missing/)).not.toBeInTheDocument();
});
it("keeps an AND with missing evidence unresolved and makes no inspector decision", () => {
  render(<ComparisonTrace composite={compositeTraceFixture("and")} />);
  expect(
    screen.getByText("Составное условие · Недостаточно данных для вывода"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Ветвь unresolved" })).getByText(
      /Определяет результат/,
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Нарушение подтверждено/)).not.toBeInTheDocument();
});
it("shows unevaluated applicability blockers without marking them checked", () => {
  const trace = compositeTraceFixture("and");
  trace.applicability = trace.root.applicability = "unknown";
  trace.root.evaluated = false;
  trace.root.reasons = ["composite_applicability_unknown"];
  trace.root.children = trace.root.children.map((branch) => ({
    ...branch,
    result: "unknown",
    applicability: "unknown",
    evaluated: false,
    scalar: null,
    reasons: ["composite_member_context_mismatch"],
  }));
  render(<ComparisonTrace composite={trace} />);
  expect(screen.getAllByText(/Не вычислялась/)).toHaveLength(3);
  expect(
    screen.getAllByText("Источники относятся к разным областям или периодам."),
  ).toHaveLength(2);
  expect(
    screen.queryByText(/composite_member_context/),
  ).not.toBeInTheDocument();
});
it("opens only matching frozen source targets and rejects an artifact from another snapshot", () => {
  const trace = compositeTraceFixture();
  const source = trace.root.children[0]!.sources[0]!;
  const target = {
    extractionId: source.extraction_id,
    fileId: source.file_id,
    artifactId: source.artifact_id!,
    page: 3,
    blockId: "p3-b2",
    label: "Синтетический документ",
  };
  const onOpenSource = vi.fn();
  const view = render(
    <ComparisonTrace
      composite={trace}
      sources={[target]}
      onOpenSource={onOpenSource}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Ветвь known: Синтетический документ, страница 3",
    }),
  );
  expect(onOpenSource).toHaveBeenCalledExactlyOnceWith(target);
  view.rerender(
    <ComparisonTrace
      composite={trace}
      sources={[{ ...target, artifactId: "another-artifact" }]}
      onOpenSource={onOpenSource}
    />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  view.rerender(
    <ComparisonTrace
      composite={{
        ...trace,
        root: {
          ...trace.root,
          children: trace.root.children.map((branch) => ({
            ...branch,
            sources: branch.sources.map((item) => ({
              ...item,
              artifact_id: null,
            })),
          })),
        },
      }}
      sources={[target]}
      onOpenSource={onOpenSource}
    />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
