import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { retryParsing } from "@/api/endpoints/parsing";
import { ApiError } from "@/api/errors";
import { parsedFile, parsingObjectId } from "@/api/types/parsing-test-fixtures";
import { RetryParsingButton } from "./RetryParsingButton";

vi.mock("@/api/endpoints/parsing", () => ({ retryParsing: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe("manual parsing retry", () => {
  it("не повторяет мутацию автоматически и сохраняет request_id при потере ответа", async () => {
    vi.mocked(retryParsing)
      .mockRejectedValueOnce(new ApiError("Соединение прервано"))
      .mockResolvedValue(undefined);
    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <RetryParsingButton objectId={parsingObjectId} file={parsedFile} />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить обработку" }),
    );
    await screen.findByRole("alert");
    expect(retryParsing).toHaveBeenCalledTimes(1);
    const firstInput = vi.mocked(retryParsing).mock.calls[0]?.[0];
    expect(firstInput?.objectId).toBe(parsingObjectId);
    expect(firstInput?.fileId).toBe(parsedFile.file_id);
    expect(firstInput?.requestId).toEqual(expect.any(String));
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить обработку" }),
    );
    await screen.findByText("Повторная обработка принята.");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Повторить обработку" }),
      ).toBeEnabled(),
    );
    expect(vi.mocked(retryParsing).mock.calls[1]?.[0]).toEqual(firstInput);
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить обработку" }),
    );
    await waitFor(() => expect(retryParsing).toHaveBeenCalledTimes(3));
    expect(vi.mocked(retryParsing).mock.calls[2]?.[0]?.requestId).not.toEqual(
      firstInput?.requestId,
    );
    unmount();
    client.clear();
  });
  it("не предлагает повтор без разрешения сервера", () => {
    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <RetryParsingButton
          objectId={parsingObjectId}
          file={{ ...parsedFile, can_retry: false }}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();
    client.clear();
  });
});
