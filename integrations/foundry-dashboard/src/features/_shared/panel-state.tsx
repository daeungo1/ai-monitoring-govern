import type { ReactNode } from "react";
import { AlertTriangle, KeyRound, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api/client";

export interface PanelErrorProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function PanelError({ error, onRetry, className }: PanelErrorProps) {
  const apiErr = error instanceof ApiError ? error : null;
  const isAuth = apiErr?.code === "auth";
  const isNotConfigured = apiErr?.code === "not_configured";
  const Icon = isAuth ? KeyRound : AlertTriangle;

  let title = "Couldn’t load this panel.";
  let detail = apiErr?.message ?? (error instanceof Error ? error.message : "Unknown error.");
  if (isAuth) {
    title = "Sign in to Azure required.";
    detail = "The server couldn’t reach Azure. Run `az login` in a terminal and retry.";
  } else if (isNotConfigured) {
    title = "Server not configured.";
    detail = apiErr?.message ?? "Missing Application Insights configuration.";
  } else if (apiErr?.code === "throttled") {
    title = "Throttled by Azure.";
    detail = apiErr.message;
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col items-start justify-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-4 text-xs",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-destructive">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-muted-foreground">{detail}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export interface PanelEmptyProps {
  message?: string;
  className?: string;
}

export function PanelEmpty({ message = "No activity in this range.", className }: PanelEmptyProps) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center rounded-md border border-dashed border-border/60 p-4 text-xs text-muted-foreground",
        className,
      )}
    >
      {message}
    </div>
  );
}

export interface PanelSkeletonProps {
  className?: string;
  children?: ReactNode;
}

export function PanelSkeleton({ className, children }: PanelSkeletonProps) {
  return <Skeleton className={cn("h-40 w-full", className)}>{children}</Skeleton>;
}
