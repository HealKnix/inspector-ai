import {
  downloadOriginal,
  getReceipt,
  uploadDocuments,
} from "@/api/endpoints/objects";
import type { UploadResponse } from "@/api/types/objects";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentUploader } from "./DocumentUploader";

vi.mock("@/api/endpoints/objects", () => ({
  getReceipt: vi.fn(),
  uploadDocuments: vi.fn(),
  downloadOriginal: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const objectId = "11111111-1111-4111-8111-111111111111";
function receipt(uploadId: string): UploadResponse {
  return {
    schema_version: 1,
    object_id: objectId,
    client_upload_id: uploadId,
    process_id: "22222222-2222-4222-8222-222222222222",
    run_id: "33333333-3333-4333-8333-333333333333",
    files: [
      {
        client_file_id: "44444444-4444-4444-8444-444444444444",
        original_name: "synthetic.xml",
        accepted: true,
        file_id: "55555555-5555-4555-8555-555555555555",
        sha256: "a".repeat(64),
        format: "XML",
        size: 4,
      },
    ],
  };
}
function mount(path = "/app") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DocumentUploader objectId={objectId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
describe("document upload recovery", () => {
  it("restores duplicate outcomes after reload and downloads the existing original", async () => {
    const id = "66666666-6666-4666-8666-666666666666";
    const existingId = "55555555-5555-4555-8555-555555555555";
    vi.mocked(getReceipt).mockResolvedValue({
      ...receipt(id),
      process_id: null,
      run_id: null,
      files: [
        {
          client_file_id: "44444444-4444-4444-8444-444444444444",
          original_name: "renamed.xml",
          accepted: false,
          error: "duplicate_file",
          existing_file_id: existingId,
          message:
            "Файл уже загружен в этот объект. Повторная копия не создана.",
        },
      ],
    });
    vi.mocked(downloadOriginal).mockResolvedValue(undefined);
    const user = mount("/app?upload=" + id);
    expect(
      await screen.findByText(
        "Все файлы уже загружены. Повторная обработка не запущена.",
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Скачать загруженный файл" }),
    );
    expect(downloadOriginal).toHaveBeenCalledWith(
      objectId,
      existingId,
      "renamed.xml",
    );
    expect(uploadDocuments).not.toHaveBeenCalled();
    vi.mocked(downloadOriginal).mockRejectedValue(
      new Error("Нет доступа к объекту"),
    );
    await user.click(
      screen.getByRole("button", { name: "Скачать загруженный файл" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нет доступа к объекту",
    );
  });

  it("separates transfer from server checks and allows selecting the same file for a new package", async () => {
    let finish!: (value: UploadResponse) => void;
    let uploadId = "";
    vi.mocked(uploadDocuments).mockImplementation((input) => {
      uploadId = input.uploadId;
      input.onProgress(100);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const user = mount();
    const file = new File(["<r/>"], "synthetic.xml", {
      type: "application/xml",
    });
    const input = screen.getByLabelText("Выберите файлы");
    await user.upload(input, file);
    await user.click(
      screen.getByRole("button", { name: "Загрузить документы" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Сервер проверяет",
    );
    expect(getReceipt).not.toHaveBeenCalled();
    expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Добавить папку" }),
    ).toBeDisabled();
    fireEvent.drop(screen.getByText("Перетащите файлы сюда"), {
      dataTransfer: { files: [new File(["<r/>"], "late.xml")] },
    });
    expect(screen.queryByText("late.xml")).not.toBeInTheDocument();
    vi.mocked(getReceipt).mockImplementation(() =>
      Promise.resolve(receipt(uploadId)),
    );
    await act(() => Promise.resolve(receipt(uploadId)).then(finish));
    expect(await screen.findByText("Оригинал принят")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Новый пакет" }));
    expect(
      screen.getByRole("button", { name: "Загрузить документы" }),
    ).toBeDisabled();
    await user.upload(input, file);
    expect(
      screen.getByRole("button", { name: "Загрузить документы" }),
    ).toBeEnabled();
  });

  it("restores a receipt from the deep link after reload without resubmitting bytes", async () => {
    const id = "66666666-6666-4666-8666-666666666666";
    vi.mocked(getReceipt).mockResolvedValue(receipt(id));
    mount("/app?upload=" + id);
    expect(await screen.findByText("Оригинал принят")).toBeInTheDocument();
    await waitFor(() =>
      expect(getReceipt).toHaveBeenCalledWith(objectId, id, expect.anything()),
    );
    expect(uploadDocuments).not.toHaveBeenCalled();
  });
});
