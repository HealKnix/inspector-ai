import { describe, expect, it } from "vitest";
import { scannerVerdict } from "./file-safety.service.js";

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
