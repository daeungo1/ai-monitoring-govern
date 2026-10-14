import * as React from "react";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Sidebar content (nav links, logo). Caller wires routing. */
  sidebar: React.ReactNode;
  /** Sticky header content (page title, filters, actions). */
  header: React.ReactNode;
  /** Optional brand row above the sidebar nav. */
  brand?: React.ReactNode;
  /** Sidebar width in pixels on desktop. Defaults to 224. */
  sidebarWidth?: number;
}

/**
 * Presentational application shell:
 * - Fixed left sidebar on desktop (>= md), collapses into an overlay drawer below.
 * - Sticky header, scrollable main column, never clips.
 * - Purely presentational; no routing or data.
 */
const AppShell = React.forwardRef<HTMLDivElement, AppShellProps>(
  (
    {
      sidebar,
      header,
      brand,
      sidebarWidth = 224,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const closeDrawer = React.useCallback(() => setOpen(false), []);

    return (
      <div
        ref={ref}
        className={cn(
          "flex min-h-screen w-full bg-background text-foreground",
          className,
        )}
        {...props}
      >
        {/* Desktop sidebar */}
        <aside
          className="hidden shrink-0 border-r border-border bg-card md:flex md:flex-col"
          style={{ width: sidebarWidth }}
          aria-label="Primary"
        >
          {brand ? (
            <div className="flex h-12 items-center border-b border-border px-3">
              {brand}
            </div>
          ) : null}
          <nav className="flex-1 overflow-y-auto p-2">{sidebar}</nav>
        </aside>

        {/* Mobile drawer */}
        {open ? (
          <div
            className="fixed inset-0 z-40 md:hidden"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-background/70 backdrop-blur-sm"
              onClick={closeDrawer}
            />
            <aside
              className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col border-r border-border bg-card shadow-xl"
              aria-label="Primary"
            >
              <div className="flex h-12 items-center justify-between border-b border-border px-3">
                <div className="min-w-0 truncate">{brand}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={closeDrawer}
                  aria-label="Close navigation"
                >
                  <X />
                </Button>
              </div>
              <nav
                className="flex-1 overflow-y-auto p-2"
                onClick={closeDrawer}
              >
                {sidebar}
              </nav>
            </aside>
          </div>
        ) : null}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {header}
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
        </div>
      </div>
    );
  },
);
AppShell.displayName = "AppShell";

export { AppShell };
