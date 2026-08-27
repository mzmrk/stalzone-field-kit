export const OPTIMIZER_ERROR_MESSAGE_KEYS = {
  optimizer_invalid_result: "The optimizer rejected an inconsistent solver result. Reload and try again; report it if the problem repeats.",
  optimizer_search_failed: "The optimizer could not complete this search. Try narrower filters or reload the page.",
  optimizer_worker_failed: "The optimizer worker stopped unexpectedly. Reload and try again.",
} as const;

export const PRICING_ERROR_MESSAGE_KEYS = {
  pricing_download_failed: "Couldn’t download the current market-price index.",
  pricing_invalid_data: "The downloaded market-price index is invalid.",
} as const;

export type OptimizerErrorCode = keyof typeof OPTIMIZER_ERROR_MESSAGE_KEYS;
export type PricingErrorCode = keyof typeof PRICING_ERROR_MESSAGE_KEYS;
export type AppErrorCode = OptimizerErrorCode | PricingErrorCode;
export type OptimizerWorkerErrorMessage = {
  type: "error";
  code: OptimizerErrorCode;
  technicalMessage: string;
};

export class AppError extends Error {
  constructor(readonly code: AppErrorCode, technicalMessage: string) {
    super(technicalMessage);
    this.name = "AppError";
  }
}

export function appErrorMessageKey(code: AppErrorCode) {
  if (code in OPTIMIZER_ERROR_MESSAGE_KEYS) {
    return OPTIMIZER_ERROR_MESSAGE_KEYS[code as OptimizerErrorCode];
  }
  return PRICING_ERROR_MESSAGE_KEYS[code as PricingErrorCode];
}

export function pricingErrorCode(error: unknown): PricingErrorCode {
  if (error instanceof AppError && error.code in PRICING_ERROR_MESSAGE_KEYS) {
    return error.code as PricingErrorCode;
  }
  return "pricing_download_failed";
}

export function optimizerWorkerError(error: unknown): OptimizerWorkerErrorMessage {
  const code = error instanceof AppError && error.code in OPTIMIZER_ERROR_MESSAGE_KEYS
    ? error.code as OptimizerErrorCode
    : "optimizer_search_failed";
  return { type: "error", code, technicalMessage: technicalErrorMessage(error) };
}

export function technicalErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
