import type { ErrorCode } from "../shared/contracts/index.js";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus = 500,
  ) {
    super(message);
  }
}

export function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /az login|azureclicredential|credential|authentication|unauthorized|forbidden|login/i.test(message);
}

export function isThrottleError(error: unknown): boolean {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : NaN;
  const message = error instanceof Error ? error.message : String(error);
  return statusCode === 429 || /429|throttl|rate.?limit/i.test(message);
}

export function retryAfterMs(error: unknown): number | null {
  const retryAfter = typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { headers?: { get?: (name: string) => string | null } } }).response?.headers?.get?.("retry-after")
    : null;
  if (!retryAfter) return null;
  const seconds = Number.parseInt(retryAfter, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}
