/**
 * Typed Fastify API client.
 *
 * - URL builder serialises arrays as repeated keys (`?model=a&model=b`) — that
 *   matches what `shared/contracts` `FiltersQuerySchema` parses on the server.
 * - On 2xx returns the full `ApiResponse<T>` envelope so callers can read both
 *   `data` and `meta` (source/freshness/warnings/...).
 * - On non-2xx parses the `{ meta, error: { code, message } }` envelope and
 *   throws a typed `ApiError`. Network/parse failures throw `ApiError` with
 *   `code: "upstream"`.
 */
import type {
  ApiErrorResponse,
  ApiResponse,
  ErrorCode,
  Meta,
} from "@shared/contracts";

import type { QueryParamRecord } from "@/types/dashboard";

/** Base path for the Fastify API. Relative so Vite's `/api` proxy handles dev. */
const API_BASE = "/api";

/** Typed error thrown by `apiFetch` for any non-2xx response or transport failure. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly meta: Meta | null;

  constructor(code: ErrorCode, message: string, httpStatus: number, meta: Meta | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.meta = meta;
  }
}

/**
 * Build a `URLSearchParams` from a loose record. Arrays become repeated keys.
 * Undefined / empty-string values are omitted.
 */
export function buildSearchParams(params: QueryParamRecord | undefined): URLSearchParams {
  const usp = new URLSearchParams();
  if (!params) return usp;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === "") continue;
        usp.append(key, item);
      }
      continue;
    }
    if (value === "") continue;
    usp.append(key, value);
  }
  return usp;
}

export interface ApiFetchOptions {
  /** Optional abort signal forwarded to `fetch` (TanStack Query supplies one). */
  signal?: AbortSignal;
}

function isErrorEnvelope(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { error?: unknown; meta?: unknown };
  if (typeof candidate.error !== "object" || candidate.error === null) return false;
  const err = candidate.error as { code?: unknown; message?: unknown };
  return typeof err.code === "string" && typeof err.message === "string";
}

/**
 * Fetch a typed API endpoint. Returns the envelope on success; throws `ApiError`
 * on any non-2xx response or transport failure.
 */
export async function apiFetch<T>(
  path: string,
  params: QueryParamRecord = {},
  options: ApiFetchOptions = {},
): Promise<ApiResponse<T>> {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const search = buildSearchParams(params);
  const qs = search.toString();
  const url = `${API_BASE}${suffix}${qs ? `?${qs}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    const message = cause instanceof Error ? cause.message : "Network request failed.";
    throw new ApiError("upstream", message, 0, null);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError("upstream", `Request failed with HTTP ${response.status}.`, response.status, null);
    }
    throw new ApiError("upstream", "Server returned a non-JSON response.", response.status, null);
  }

  if (!response.ok) {
    if (isErrorEnvelope(body)) {
      throw new ApiError(body.error.code, body.error.message, response.status, body.meta);
    }
    throw new ApiError("upstream", `Request failed with HTTP ${response.status}.`, response.status, null);
  }

  return body as ApiResponse<T>;
}
