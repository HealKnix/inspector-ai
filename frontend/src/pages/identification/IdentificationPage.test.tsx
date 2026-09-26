import { getKindOptions } from "@/api/endpoints/classification";
import {
  applyIdentification,
  getIdentification,
  getIdentificationDocument,
} from "@/api/endpoints/identification";
import { getParseResult, getParsingStatus } from "@/api/endpoints/parsing";
import { ApiError } from "@/api/errors";
import {
  parsedFile,
  parseResult,
  parsingStatus,
} from "@/api/types/parsing-test-fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { IdentificationPage } from "./IdentificationPage";
import { idRegistry } from "./lib/identification-test-fixtures";

vi.mock("@/api/endpoints/identification", () => ({
  getIdentification: vi.fn(),
  getIdentificationDocument: vi.fn(),
  applyIdentification: vi.fn(),
}));
vi.mock("@/api/endpoints/classification", () => ({ getKindOptions: vi.fn() }));
vi.mock("@/api/endpoints/parsing", () => ({
  getParseResult: vi.fn(),
  getParsingStatus: vi.fn(),
}));
vi.mock("@/components/rendered-document-page/RenderedDocumentPage", () => ({
  RenderedDocumentPage: ({
    file,
    selectedId,
  }: {
    file: { file_id: string };
    selectedId: string;
  }) => (
    <div data-testid="original-page">
      {file.file_id} {selectedId}
    </div>
  ),
}));
function Location() {
  return <p data-testid="location">{useLocation().search}</p>;
}
function mount(extraParams = "") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter
        initialEntries={[
          `/objects/${idRegistry.object_id}/documents?processId=${idRegistry.process_id}&runId=${idRegistry.run_id}&documentId=${idRegistry.documents[0]!.document_id}${extraParams}`,
        ]}
      >
        <Routes>
          <Route
            path="/objects/:objectId/documents"
            element={
              <>
                <IdentificationPage />
                <Location />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const newRun = "77777777-7777-4777-8777-777777777777";
const success = (_: string, body: Parameters<typeof applyIdentification>[1]) =>
  Promise.resolve({
    schema_version: 1 as const,
    request_id: body.request_id,
    process_id: idRegistry.process_id,
    previous_run_id: idRegistry.run_id,
    run_id: newRun,
    resolved_input_hash: "d".repeat(64),
    replayed: false,
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getIdentification).mockResolvedValue(structuredClone(idRegistry));
  vi.mocked(getIdentificationDocument).mockResolvedValue({
    ...structuredClone(idRegistry),
    document: structuredClone(idRegistry.documents[0]!),
    history: [],
  });
  vi.mocked(getKindOptions).mockResolvedValue({
    schema_version: 1,
    options: {
      PD: [],
      RD: [{ code: "AOSR", title: "Синтетический вид РД" }],
      ID: [{ code: "AOSR", title: "АОСР" }],
    },
  });
  vi.mocked(getParsingStatus).mockResolvedValue(parsingStatus);
  vi.mocked(getParseResult).mockResolvedValue(parseResult);
  vi.mocked(applyIdentification).mockImplementation(success);
});
async function confirm(edited = false) {
  await screen.findByLabelText("Номер");
  await waitFor(() =>
    expect(
      screen.getByLabelText("Вид документа", { selector: "button" }),
    ).toHaveTextContent("АОСР"),
  );
  if (edited)
    fireEvent.change(screen.getByLabelText("Номер"), {
      target: { value: "53" },
    });
  fireEvent.click(
    screen.getByRole("button", {
      name: edited ? "Сохранить и проверить" : "Подтвердить и проверить",
    }),
  );
}
it("confirms unchanged shown values in one action without confirming empty, hidden or approval fields", async () => {
  mount();
  await confirm();
  await waitFor(() => expect(applyIdentification).toHaveBeenCalledTimes(1));
  const body = vi.mocked(applyIdentification).mock.calls[0]![1];
  expect(body.documents[0]?.revisions[0]).toEqual({
    revision_id: idRegistry.documents[0]!.revisions[0]!.revision_id,
    fields: { kind_code: "AOSR", number: "52" },
  });
  expect(body.basis).toBe("Подтверждаю сведения по документу.");
  expect(body.expected_run_id).toBe(idRegistry.run_id);
  expect(body.documents[0]?.expected_version).toBe(1);
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(`runId=${newRun}`),
  );
  expect(
    screen.queryByText("Добавить уточнение в пакет"),
  ).not.toBeInTheDocument();
});
it("applies an edited field directly and preserves document navigation in the new calculation", async () => {
  mount();
  await confirm(true);
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(`runId=${newRun}`),
  );
  expect(
    vi.mocked(applyIdentification).mock.calls[0]![1].documents[0]?.revisions[0]
      ?.fields,
  ).toEqual({ kind_code: "AOSR", number: "53" });
  expect(screen.getByTestId("location")).toHaveTextContent(
    `documentId=${idRegistry.documents[0]!.document_id}`,
  );
});
it.each(["FINALIZED", "PARSING"])(
  "keeps %s read-only despite inconsistent apply permission",
  async (process_status) => {
    vi.mocked(getIdentification).mockResolvedValue({
      ...idRegistry,
      process_status,
    });
    mount();
    expect(await screen.findByLabelText("Номер")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Подтвердить и проверить" }),
    ).not.toBeInTheDocument();
    expect(applyIdentification).not.toHaveBeenCalled();
  },
);
it("pins historical evidence and prevents changes even with an inconsistent server permission", async () => {
  vi.mocked(getIdentification).mockResolvedValue({
    ...idRegistry,
    current: false,
    current_run_id: newRun,
  });
  mount();
  expect(await screen.findByLabelText("Номер")).toBeDisabled();
  await waitFor(() =>
    expect(getParseResult).toHaveBeenCalledWith(
      idRegistry.object_id,
      parsedFile.file_id,
      idRegistry.run_id,
      parsedFile.artifact_id,
      expect.any(AbortSignal),
    ),
  );
  expect(await screen.findByText("Синтетический акт №52")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Подтвердить и проверить" }),
  ).not.toBeInTheDocument();
});
it("preserves corrected input on 409 and requires explicit refresh", async () => {
  vi.mocked(applyIdentification).mockRejectedValue(
    new ApiError("internal version detail", { status: 409 }),
  );
  mount();
  await confirm(true);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Карточка или запуск изменились",
    ),
  );
  expect(screen.getByLabelText("Номер")).toHaveValue("53");
  expect(screen.getByLabelText("Номер")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Обновить карточку" }),
  ).toBeInTheDocument();
  expect(applyIdentification).toHaveBeenCalledTimes(1);
});
it("retains input after a lost response and retries the same idempotency key", async () => {
  vi.mocked(applyIdentification)
    .mockRejectedValueOnce(
      new ApiError("ECONNRESET secret implementation detail", { status: null }),
    )
    .mockImplementation(success);
  mount();
  await confirm(true);
  const retry = await screen.findByRole("button", {
    name: "Повторить отправку",
  });
  expect(screen.getByLabelText("Номер")).toHaveValue("53");
  expect(screen.getByRole("alert")).not.toHaveTextContent("ECONNRESET");
  fireEvent.click(retry);
  await waitFor(() => expect(applyIdentification).toHaveBeenCalledTimes(2));
  expect(vi.mocked(applyIdentification).mock.calls[0]![1]).toEqual(
    vi.mocked(applyIdentification).mock.calls[1]![1],
  );
});
it("switches saved text, dates and original artifact together between revisions", async () => {
  const registry = structuredClone(idRegistry);
  const first = registry.documents[0]!.revisions[0]!;
  first.fields = {
    ...first.fields,
    date: "2026-08-01",
    scope: "Корпус 1",
    works_from: "2026-08-01",
    works_to: "2026-08-31",
    revision_label: "1",
  };
  const second = structuredClone(first);
  second.revision_id = newRun;
  second.fields = {
    ...second.fields,
    number: "53",
    date: "2026-09-01",
    scope: "Корпус 2",
    works_from: "2026-09-01",
    works_to: "2026-09-20",
    revision_label: "2",
  };
  second.candidates = [];
  second.representations[0]!.file_id = newRun;
  second.representations[0]!.artifact_id =
    "88888888-8888-4888-8888-888888888888";
  registry.documents[0]!.revisions.push(second);
  vi.mocked(getIdentification).mockResolvedValue(registry);
  mount();
  expect(await screen.findByLabelText("Номер")).toHaveValue("52");
  expect(screen.getByLabelText("Дата документа")).toHaveValue("2026-08-01");
  fireEvent.click(screen.getByRole("button", { name: "Редакция 2" }));
  await waitFor(() => expect(screen.getByLabelText("Номер")).toHaveValue("53"));
  expect(screen.getByLabelText("Место работ")).toHaveValue("Корпус 2");
  expect(screen.getByLabelText("Работы с")).toHaveValue("2026-09-01");
  await waitFor(() =>
    expect(getParseResult).toHaveBeenCalledWith(
      idRegistry.object_id,
      newRun,
      idRegistry.run_id,
      second.representations[0]!.artifact_id,
      expect.any(AbortSignal),
    ),
  );
});
it("does not imply source evidence for an edited value", async () => {
  mount();
  const number = await screen.findByLabelText("Номер");
  fireEvent.focus(number);
  expect(await screen.findByText("Синтетический акт №52")).toBeInTheDocument();
  fireEvent.change(number, { target: { value: "53" } });
  await waitFor(() =>
    expect(screen.queryByText("Синтетический акт №52")).not.toBeInTheDocument(),
  );
});
it("keeps partial sheet replacement restricted after confirmation and never offers approval", async () => {
  const registry = structuredClone(idRegistry);
  registry.documents[0]!.revisions[0]!.blockers = [
    "unsupported_partial_replacement",
  ];
  vi.mocked(getIdentification).mockResolvedValue(registry);
  mount();
  expect(
    await screen.findByText(/В файле заменены отдельные листы/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Уточнить утверждение редакции"),
  ).not.toBeInTheDocument();
  await confirm();
  await waitFor(() => expect(applyIdentification).toHaveBeenCalled());
  expect(
    vi.mocked(applyIdentification).mock.calls[0]![1].documents[0]?.revisions[0]
      ?.approval,
  ).toBeUndefined();
});
it("exposes a conflicting own title for correction without confirming hidden metadata", async () => {
  const registry = structuredClone(idRegistry);
  registry.documents[0]!.revisions[0]!.blockers = ["field_conflict:title"];
  vi.mocked(getIdentification).mockResolvedValue(registry);
  mount();
  expect(await screen.findByLabelText("Название документа")).toBeVisible();
  expect(
    screen.getByRole("complementary", { name: "Следующий шаг" }),
  ).toHaveTextContent("Название документа");
  await confirm();
  await waitFor(() => expect(applyIdentification).toHaveBeenCalled());
  expect(
    vi.mocked(applyIdentification).mock.calls[0]![1].documents[0]?.revisions[0]
      ?.fields?.title,
  ).toBe("Синтетический АОСР №52");
});
it("can remove a previous manual reference to return selection to the system", async () => {
  const registry = structuredClone(idRegistry);
  const revision = registry.documents[0]!.revisions[0]!;
  revision.reference_revision_id = newRun;
  revision.blockers = ["reference_scope_mismatch"];
  vi.mocked(getIdentification).mockResolvedValue(registry);
  mount();
  await screen.findByLabelText("Номер");
  fireEvent.click(screen.getByText("Другие реквизиты и решения"));
  fireEvent.click(
    screen.getByRole("button", { name: "Подобрать связь автоматически" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить и проверить" }),
  );
  await waitFor(() => expect(applyIdentification).toHaveBeenCalled());
  expect(
    vi.mocked(applyIdentification).mock.calls[0]![1].documents[0]?.revisions[0]
      ?.reference_revision_id,
  ).toBeNull();
});
it("keeps an older snapshot of the same run pinned until opening the current calculation", async () => {
  const oldHash = idRegistry.resolved_input_hash!;
  const latestHash = "e".repeat(64);
  vi.mocked(getIdentification).mockImplementation(
    (_process, _run, _signal, hash) =>
      Promise.resolve({
        ...idRegistry,
        current: hash !== oldHash,
        allowed_actions: { apply: hash !== oldHash },
        resolved_input_hash: hash ?? latestHash,
        snapshot_versions: [
          {
            version: 1,
            resolved_input_hash: oldHash,
            created_at: "2026-09-25T10:00:00Z",
          },
          {
            version: 2,
            resolved_input_hash: latestHash,
            created_at: "2026-09-25T11:00:00Z",
          },
        ],
      }),
  );
  mount(`&resolvedInputHash=${oldHash}`);
  expect(await screen.findByLabelText("Номер")).toBeDisabled();
  await waitFor(() =>
    expect(getIdentificationDocument).toHaveBeenCalledWith(
      idRegistry.process_id,
      idRegistry.run_id,
      idRegistry.documents[0]!.document_id,
      expect.any(AbortSignal),
      oldHash,
    ),
  );
  fireEvent.click(screen.getByText("История расчётов"));
  fireEvent.click(
    screen.getByRole("button", { name: "Открыть текущий расчёт" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Номер")).not.toBeDisabled(),
  );
  expect(screen.getByTestId("location")).not.toHaveTextContent(
    "resolvedInputHash=",
  );
});

it("requires a separate approval decision and its basis before sending approval", async () => {
  mount();
  await screen.findByLabelText("Номер");
  fireEvent.click(screen.getByText("Другие реквизиты и решения"));
  fireEvent.click(screen.getByText("Уточнить утверждение редакции"));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Утверждение редакции подтверждено" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить и проверить" }),
  );
  expect(
    await screen.findByText(
      "Укажите документ или решение, подтверждающее утверждение",
    ),
  ).toBeInTheDocument();
  expect(applyIdentification).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Основание утверждения"), {
    target: { value: "Синтетическое решение об утверждении" },
  });
  fireEvent.change(screen.getByLabelText("Действует с"), {
    target: { value: "2026-08-01" },
  });
  await waitFor(() =>
    expect(
      screen.queryByText(
        "Укажите документ или решение, подтверждающее утверждение",
      ),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить и проверить" }),
  );
  await waitFor(() => expect(applyIdentification).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(applyIdentification).mock.calls[0]![1].documents[0]?.revisions[0]
      ?.approval,
  ).toEqual({
    confirmed: true,
    effective_from: "2026-08-01",
    effective_to: null,
    replaces_revision_id: null,
    basis: "Синтетическое решение об утверждении",
  });
});
it("keeps hidden metadata unchanged and sends only explicit advanced corrections", async () => {
  mount();
  await screen.findByLabelText("Номер");
  fireEvent.click(screen.getByText("Другие реквизиты и решения"));
  fireEvent.change(screen.getByLabelText("Название документа"), {
    target: { value: "Уточнённое синтетическое название" },
  });
  fireEvent.click(screen.getByText("Другие реквизиты и решения"));
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить и проверить" }),
  );
  await waitFor(() => expect(applyIdentification).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(applyIdentification).mock.calls[0]![1].documents[0]?.revisions[0]
      ?.fields,
  ).toEqual({
    kind_code: "AOSR",
    number: "52",
    title: "Уточнённое синтетическое название",
  });
});
it("replays a lost response even after the refreshed registry marks its old run historical", async () => {
  let reads = 0;
  vi.mocked(getIdentification).mockImplementation(() =>
    Promise.resolve({
      ...idRegistry,
      current: ++reads === 1,
      current_run_id: reads === 1 ? idRegistry.run_id : newRun,
    }),
  );
  vi.mocked(applyIdentification)
    .mockRejectedValueOnce(new ApiError("lost response", { status: null }))
    .mockImplementation(success);
  mount();
  await confirm(true);
  const retry = await screen.findByRole("button", {
    name: "Повторить отправку",
  });
  expect(screen.getByLabelText("Номер")).toBeDisabled();
  expect(screen.getByLabelText("Номер")).toHaveValue("53");
  fireEvent.click(retry);
  await waitFor(() => expect(applyIdentification).toHaveBeenCalledTimes(2));
  expect(vi.mocked(applyIdentification).mock.calls[0]![1]).toEqual(
    vi.mocked(applyIdentification).mock.calls[1]![1],
  );
});

it("changes stage in advanced fields without forcing an unknown kind and updates the main fields", async () => {
  mount();
  await screen.findByLabelText("Номер");
  fireEvent.click(screen.getByText("Другие реквизиты и решения"));
  fireEvent.click(
    screen.getByLabelText("Стадия документа", { selector: "button" }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "Рабочая документация" }),
  );
  expect(
    screen.getByLabelText("Область применения / часть объекта"),
  ).toBeVisible();
  expect(screen.getByLabelText("Шифр документа")).toBeVisible();
  expect(
    screen.getByLabelText("Вид документа", { selector: "button" }),
  ).toHaveTextContent("Не выбрано");
  fireEvent.click(screen.getByText("Другие реквизиты и решения"));
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить и проверить" }),
  );
  await waitFor(() => expect(applyIdentification).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(applyIdentification).mock.calls[0]![1].documents[0]?.revisions[0]
      ?.fields,
  ).toEqual({ kind_code: null, stage: "RD" });
});
