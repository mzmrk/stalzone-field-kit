import { describe, expect, it } from "vitest";
import {
  AppError,
  appErrorMessageKey,
  optimizerWorkerError,
  pricingErrorCode,
} from "./app-errors";

describe("user-facing error contract", () => {
  it("preserves a stable optimizer code while retaining technical diagnostics", () => {
    const payload = optimizerWorkerError(new AppError(
      "optimizer_invalid_result",
      "MILP solver returned a non-integral artifact selection.",
    ));

    expect(payload).toEqual({
      type: "error",
      code: "optimizer_invalid_result",
      technicalMessage: "MILP solver returned a non-integral artifact selection.",
    });
    expect(appErrorMessageKey(payload.code)).not.toContain("non-integral");
  });

  it("hides unexpected optimizer details behind a localized message key", () => {
    const payload = optimizerWorkerError(new Error("secret implementation detail"));

    expect(payload.code).toBe("optimizer_search_failed");
    expect(payload.technicalMessage).toBe("secret implementation detail");
    expect(appErrorMessageKey(payload.code)).not.toContain("secret implementation detail");
  });

  it("classifies pricing validation separately from download failures", () => {
    expect(pricingErrorCode(new AppError("pricing_invalid_data", "bad schema"))).toBe("pricing_invalid_data");
    expect(pricingErrorCode(new TypeError("network offline"))).toBe("pricing_download_failed");
  });
});
