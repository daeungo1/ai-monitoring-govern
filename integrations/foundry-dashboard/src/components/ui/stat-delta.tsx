import * as React from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";

export interface StatDeltaProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Numeric delta; sign drives the arrow + color. */
  value: number;
  /** When true, an upward delta is treated as bad (e.g. error rate, latency). */
  invert?: boolean;
  /** Optional formatter — defaults to "+12.3%" / "-4.0%". */
  format?: (value: number) => string;
}

function defaultFormat(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

const StatDelta = React.forwardRef<HTMLSpanElement, StatDeltaProps>(
  ({ value, invert = false, format = defaultFormat, className, ...props }, ref) => {
    const flat = value === 0 || Number.isNaN(value);
    const goodWhenUp = !invert;
    const positive = value > 0;
    const tone = flat
      ? "text-muted-foreground"
      : positive === goodWhenUp
        ? "text-success"
        : "text-destructive";
    const Icon = flat ? ArrowRight : positive ? ArrowUp : ArrowDown;
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-0.5 text-xs font-medium num",
          tone,
          className,
        )}
        {...props}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {format(value)}
      </span>
    );
  },
);
StatDelta.displayName = "StatDelta";

export { StatDelta };
