import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSafetyService, scannerVerdict } from "./file-safety.service.js";
import { PrivateStorageService } from "./private-storage.service.js";

describe("ClamAV verdicts", () => {
  it("distinguishes a clean stream and an actual signature", () => {
    expect(scannerVerdict("stream: OK")).toBe("clean");
    expect(scannerVerdict("stream: Eicar-Test-Signature FOUND")).toBe(
      "infected",
    );
  });
  it.each(["MaxScanTime", "MaxScanSize", "MaxFileSize"])(
    "reports %s as a scan limit, not an infection",
    (limit) => {
      expect(
        scannerVerdict(`stream: Heuristics.Limits.Exceeded.${limit} FOUND`),
      ).toBe("limit");
    },
  );
  it("fails closed for unknown or truncated protocol responses", () => {
    expect(() => scannerVerdict("stream: timeout ERROR")).toThrow();
    expect(() => scannerVerdict("OK")).toThrow();
  });
});

describe("structural validator adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(timeoutSeconds?: number | string) {
    const config = new ConfigService({
      FILE_VALIDATOR_URL: "http://validator.test:8081",
      FILE_VALIDATOR_TIMEOUT_SECONDS: timeoutSeconds,
    });
    const service = new FileSafetyService(
      config,
      new PrivateStorageService(config),
    );
    // Isolate the HTTP adapter: ClamAV verdict parsing is covered above.
    const scan = vi.spyOn(
      service as unknown as {
        scan(key: string): Promise<"clean" | "infected" | "limit">;
      },
      "scan",
    );
    scan.mockResolvedValue("clean");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    return { service, scan, fetchMock, timeout, signal };
  }

  it.each(["PDF", "DOCX", "XML"])(
    "accepts a completed %s verdict after antivirus approval",
    async (format) => {
      const { service, scan, fetchMock, timeout, signal } = setup();
      fetchMock.mockResolvedValue(Response.json({ format }));

      await expect(service.inspect("quarantine-key")).resolves.toEqual({
        format,
      });
      expect(scan).toHaveBeenCalledWith("quarantine-key");
      expect(timeout).toHaveBeenCalledWith(190_000);
      expect(fetchMock).toHaveBeenCalledWith("http://validator.test:8081", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "quarantine-key" }),
        signal,
        redirect: "error",
      });
    },
  );

  it.each([
    [25, 35_000],
    [300, 310_000],
    ["120", 130_000],
  ])(
    "waits for the configured %s-second budget plus reply margin",
    async (budget, expected) => {
      const { service, fetchMock, timeout } = setup(budget);
      fetchMock.mockResolvedValue(Response.json({ format: "PDF" }));

      await expect(service.inspect("quarantine-key")).resolves.toEqual({
        format: "PDF",
      });
      expect(timeout).toHaveBeenCalledWith(expected);
    },
  );

  it("preserves a confirmed unsafe verdict as unsafe_format", async () => {
    const { service, fetchMock } = setup();
    fetchMock.mockResolvedValue(Response.json({ error: "unsafe_format" }));

    await expect(service.inspect("quarantine-key")).resolves.toMatchObject({
      error: "unsafe_format",
    });
  });

  it.each([
    { error: "validator_unavailable" },
    { error: "unsafe_format" },
    { format: "PDF" },
  ])(
    "treats HTTP 503 as unavailable regardless of its body: %j",
    async (body) => {
      const { service, fetchMock } = setup();
      fetchMock.mockResolvedValue(Response.json(body, { status: 503 }));

      await expect(service.inspect("quarantine-key")).resolves.toMatchObject({
        error: "validator_unavailable",
      });
    },
  );

  it.each([201, 302, 500])(
    "fails closed for unexpected HTTP %s",
    async (status) => {
      const { service, fetchMock } = setup();
      fetchMock.mockResolvedValue(Response.json({ format: "PDF" }, { status }));

      await expect(service.inspect("quarantine-key")).resolves.toMatchObject({
        error: "validator_unavailable",
      });
    },
  );

  it.each([
    null,
    [],
    {},
    { format: "EXE" },
    { error: "timeout" },
    { format: "PDF", error: "unsafe_format" },
    { format: "PDF", error: "validator_unavailable" },
    { format: "PDF", unexpected: true },
    { error: "unsafe_format", unexpected: true },
  ])("fails closed for an invalid or ambiguous payload: %j", async (body) => {
    const { service, fetchMock } = setup();
    fetchMock.mockResolvedValue(Response.json(body));

    await expect(service.inspect("quarantine-key")).resolves.toMatchObject({
      error: "validator_unavailable",
    });
  });

  it("reports malformed JSON as unavailable", async () => {
    const { service, fetchMock } = setup();
    fetchMock.mockResolvedValue(new Response('{"format":'));

    await expect(service.inspect("quarantine-key")).resolves.toMatchObject({
      error: "validator_unavailable",
    });
  });

  it.each([
    new DOMException("The operation timed out", "TimeoutError"),
    new TypeError("fetch failed"),
  ])("reports a transport failure as unavailable: %s", async (error) => {
    const { service, fetchMock } = setup();
    fetchMock.mockRejectedValue(error);

    await expect(service.inspect("quarantine-key")).resolves.toEqual({
      error: "validator_unavailable",
      message: "Проверка структуры недоступна. Файл не принят.",
    });
  });

  it.each([
    ["infected", "infected"],
    ["limit", "scanner_limit"],
  ] as const)(
    "does not bypass antivirus verdict %s",
    async (verdict, error) => {
      const { service, scan, fetchMock } = setup();
      scan.mockResolvedValue(verdict);

      await expect(service.inspect("quarantine-key")).resolves.toMatchObject({
        error,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
