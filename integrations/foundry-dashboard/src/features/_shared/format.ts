/**
 * Tiny presentation-only formatters used across the dashboard.
 * All formatters are tolerant of NaN/undefined and never throw.
 */

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const COST = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const COST_LARGE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const COST_PRECISE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 8,
});

const PCT = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const PCT0 = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/** Compact token count: 12.3k, 1.2M. */
export function formatTokens(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  return COMPACT.format(n);
}

/** Full integer with thousand separators. */
export function formatInt(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  return INT.format(n);
}

/** Currency. Auto-switches to compact at $1k+. */
export function formatCost(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  if (n === 0) return "$0.00";
  if (Math.abs(n) >= 1000) return COST_LARGE.format(n);
  if (Math.abs(n) < 0.01) return COST_PRECISE.format(n);
  return COST.format(n);
}

/** Fraction 0..1 → "12.3%". */
export function formatPct(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  return PCT.format(n);
}

/** Fraction 0..1 → "12%". */
export function formatPct0(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  return PCT0.format(n);
}

/** Latency in ms → "123ms" / "1.2s". */
export function formatMs(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 1 : 2)}s`;
  return `${Math.round(n)}ms`;
}

/** Compact ratio 0..1 → "0.42". */
export function formatRatio(value: unknown): string {
  const n = num(value);
  if (n === null) return "—";
  return n.toFixed(2);
}

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function parseTs(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTickTime(value: unknown): string {
  const d = parseTs(value);
  return d ? TIME_FMT.format(d) : "";
}

export function formatTickDateTime(value: unknown): string {
  const d = parseTs(value);
  return d ? DATETIME_FMT.format(d) : "";
}

export function formatTickDate(value: unknown): string {
  const d = parseTs(value);
  return d ? DATE_FMT.format(d) : "";
}

export function formatAbsoluteTime(value: unknown): string {
  const d = parseTs(value);
  if (!d) return "—";
  return `${DATE_FMT.format(d)} ${TIME_FMT.format(d)}`;
}

export function formatRelativeTime(value: unknown): string {
  const d = parseTs(value);
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
