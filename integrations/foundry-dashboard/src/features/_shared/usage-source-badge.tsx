/**
 * Tiny presentational badge that labels a panel's data lens.
 *
 * The dashboard exposes telemetry through two distinct lenses; this badge
 * makes that explicit at the panel level so operators don't conflate them:
 *
 *  - `platform-metrics` → Azure Monitor platform metrics on the Foundry
 *    resource. AUTHORITATIVE — matches the portal Monitor tab and reflects
 *    ALL traffic to the resource. Rendered with a success tone.
 *  - `traces` → gen_ai OpenTelemetry traces in Application Insights. A
 *    SUBSET — only includes instrumented agent/operation calls. Rendered
 *    with an outline/secondary tone.
 *
 * Labels come from `USAGE_SOURCE_LABELS` in `@/types/dashboard`.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { UsageSource } from "@shared/contracts";
import { USAGE_SOURCE_LABELS } from "@/types/dashboard";

export interface UsageSourceBadgeProps {
  /** The `meta.usageSource` value from the API envelope. */
  source: UsageSource | undefined;
  /** Optional short suffix appended after the label (e.g. "· matches portal"). */
  hint?: string;
  className?: string;
  /** Title attribute for native tooltip-on-hover. */
  title?: string;
}

export function UsageSourceBadge({
  source,
  hint,
  className,
  title,
}: UsageSourceBadgeProps) {
  if (!source) return null;
  const label = USAGE_SOURCE_LABELS[source];
  const variant: "success" | "outline" =
    source === "platform-metrics" ? "success" : "outline";
  const defaultTitle =
    source === "platform-metrics"
      ? "Azure Monitor platform metrics on the Foundry resource. Authoritative — matches the portal Monitor tab and includes all traffic."
      : "Application Insights gen_ai traces. Only includes instrumented agent/operation calls — a subset of total traffic.";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] text-muted-foreground",
        className,
      )}
      title={title ?? defaultTitle}
    >
      <Badge variant={variant} className="h-5 px-1.5 text-[10px] font-medium">
        {label}
      </Badge>
      {hint ? <span className="opacity-80">{hint}</span> : null}
    </span>
  );
}
