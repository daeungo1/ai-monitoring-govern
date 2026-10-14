/**
 * Shared `QueryClient` factory and provider wrapper for the dashboard.
 *
 * - `staleTime` ~15s + `refetchOnWindowFocus: false` keep us under the
 *   server-side throttle (ADR-0006) while still feeling live.
 * - The retry policy treats `ApiError` codes deliberately: hard errors
 *   (`auth`, `bad_request`, `not_configured`) never retry, transient ones
 *   (`throttled`, `upstream`) get a couple of tries with linear backoff.
 */
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { ApiError } from "@/lib/api/client";

const STALE_TIME_MS = 15_000;
const GC_TIME_MS = 5 * 60_000;
const MAX_RETRIES = 2;

const NON_RETRYABLE_CODES = new Set<string>(["auth", "bad_request", "not_configured"]);

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (error instanceof ApiError) {
    if (NON_RETRYABLE_CODES.has(error.code)) return false;
    return true;
  }
  // Unknown error (likely transport) — give it one more attempt.
  return failureCount < 1;
}

function retryDelay(attempt: number): number {
  // 500ms, 1500ms, capped — gentle backoff for "throttled"/"upstream".
  return Math.min(1500, 500 * (attempt + 1));
}

export const defaultQueryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      gcTime: GC_TIME_MS,
      refetchOnWindowFocus: false,
      retry: shouldRetry,
      retryDelay,
    },
    mutations: {
      retry: false,
    },
  },
};

export function createAppQueryClient(): QueryClient {
  return new QueryClient(defaultQueryClientConfig);
}

export interface AppQueryProviderProps {
  client?: QueryClient;
  children: ReactNode;
}

/**
 * Thin wrapper that owns a single `QueryClient` instance when none is supplied.
 * `@dashboard` mounts this in `src/main.tsx`.
 */
export function AppQueryProvider({ client, children }: AppQueryProviderProps) {
  // Lazily create per-tree client if caller did not pass one.
  const resolved = client ?? createAppQueryClient();
  return createElement(QueryClientProvider, { client: resolved }, children);
}
