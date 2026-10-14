import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { Operation } from "@shared/contracts";
import {
  DEFAULT_DASHBOARD_PARAMS,
  type DashboardFilters,
  type DashboardParams,
  type TimeRangePreset,
} from "@/types/dashboard";
import type { Granularity } from "@shared/contracts";

/**
 * Global dashboard params + setters. One source of truth, mounted once at the
 * root route. Feature views call `useDashboardParams()` and pass `params`
 * verbatim into hooks from `@/lib/queries`.
 */
export interface DashboardParamsContextValue {
  params: DashboardParams;
  setRangePreset: (preset: TimeRangePreset) => void;
  setCustomRange: (fromIso: string, toIso: string) => void;
  setGranularity: (g: Granularity) => void;
  setModelFilter: (models: readonly string[]) => void;
  setAgentFilter: (agents: readonly string[]) => void;
  setOperationFilter: (ops: readonly Operation[]) => void;
  reset: () => void;
  /** Force-refresh every query in the dashboard. */
  refreshAll: () => void;
}

const Ctx = createContext<DashboardParamsContextValue | null>(null);

export function DashboardParamsProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useState<DashboardParams>(DEFAULT_DASHBOARD_PARAMS);
  const qc = useQueryClient();

  const setRangePreset = useCallback((preset: TimeRangePreset) => {
    setParams((p) => ({ ...p, range: { preset } }));
  }, []);

  const setCustomRange = useCallback((fromIso: string, toIso: string) => {
    setParams((p) => ({ ...p, range: { from: fromIso, to: toIso } }));
  }, []);

  const setGranularity = useCallback((granularity: Granularity) => {
    setParams((p) => ({ ...p, granularity }));
  }, []);

  const setFilters = useCallback(
    (mut: (f: DashboardFilters) => DashboardFilters) => {
      setParams((p) => ({ ...p, filters: mut(p.filters) }));
    },
    [],
  );

  const setModelFilter = useCallback(
    (model: readonly string[]) =>
      setFilters((f) => ({ ...f, model: model.length ? [...model] : undefined })),
    [setFilters],
  );
  const setAgentFilter = useCallback(
    (agent: readonly string[]) =>
      setFilters((f) => ({ ...f, agent: agent.length ? [...agent] : undefined })),
    [setFilters],
  );
  const setOperationFilter = useCallback(
    (operation: readonly Operation[]) =>
      setFilters((f) => ({
        ...f,
        operation: operation.length ? [...operation] : undefined,
      })),
    [setFilters],
  );

  const reset = useCallback(() => setParams(DEFAULT_DASHBOARD_PARAMS), []);

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries();
  }, [qc]);

  const value = useMemo<DashboardParamsContextValue>(
    () => ({
      params,
      setRangePreset,
      setCustomRange,
      setGranularity,
      setModelFilter,
      setAgentFilter,
      setOperationFilter,
      reset,
      refreshAll,
    }),
    [
      params,
      setRangePreset,
      setCustomRange,
      setGranularity,
      setModelFilter,
      setAgentFilter,
      setOperationFilter,
      reset,
      refreshAll,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboardParams(): DashboardParamsContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useDashboardParams must be used inside DashboardParamsProvider");
  }
  return v;
}
