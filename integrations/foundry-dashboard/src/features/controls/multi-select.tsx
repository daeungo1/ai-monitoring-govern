import { useMemo } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Generic multi-select filter rendered as a dropdown of checkable rows.
 * Compose with the dashboard controls; not a primitive — lives in features.
 */
export interface MultiSelectFilterProps<T extends string> {
  label: string;
  /** Currently selected values. */
  value: readonly T[];
  /** Full list of options. */
  options: readonly { value: T; label: string }[];
  onChange: (next: T[]) => void;
  /** Optional loading state — disables the trigger. */
  isLoading?: boolean;
  /** Optional zero-state message shown when no options exist. */
  emptyMessage?: string;
  className?: string;
}

export function MultiSelectFilter<T extends string>({
  label,
  value,
  options,
  onChange,
  isLoading,
  emptyMessage = "No options",
  className,
}: MultiSelectFilterProps<T>) {
  const selected = useMemo(() => new Set(value), [value]);

  function toggle(v: T) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  }

  function clear() {
    onChange([]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          className={cn("h-8 gap-1.5 px-2 text-xs font-normal", className)}
        >
          <span className="text-muted-foreground">{label}</span>
          {value.length > 0 ? (
            <Badge variant="secondary" className="h-5 rounded px-1 text-[10px] num">
              {value.length}
            </Badge>
          ) : (
            <span className="text-muted-foreground/70">All</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">{label}</DropdownMenuLabel>
          {value.length > 0 ? (
            <button
              type="button"
              onClick={clear}
              className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="my-0" />
        {options.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">{emptyMessage}</div>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="p-1">
              {options.map((opt) => {
                const checked = selected.has(opt.value);
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    onSelect={(e) => {
                      e.preventDefault();
                      toggle(opt.value);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{opt.label}</span>
                    {checked ? (
                      <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
