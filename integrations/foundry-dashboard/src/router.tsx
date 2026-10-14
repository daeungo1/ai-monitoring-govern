import {
  Activity,
  BarChart3,
  Coins,
  Cpu,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useRouter,
  type AnyRoute,
} from "@tanstack/react-router";

import { AppShell } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  DashboardParamsProvider,
} from "@/features/controls/dashboard-params-context";
import {
  GlobalAlerts,
  HeaderControls,
} from "@/features/controls/header-controls";

import { OverviewView } from "@/features/overview/overview-view";
import { TokenomicsView } from "@/features/tokenomics/tokenomics-view";
import { ModelsView } from "@/features/models/models-view";
import { RequestsView } from "@/features/operations/requests-view";
import { CostView } from "@/features/cost/cost-view";
import { OperationsView } from "@/features/operations/operations-view";
import { PlatformView } from "@/features/platform/platform-view";

const NAV = [
  { to: "/", label: "Overview", icon: Gauge, title: undefined },
  {
    to: "/platform",
    label: "Platform Usage",
    icon: ShieldCheck,
    title:
      "Authoritative · Azure Monitor metrics — matches the Foundry portal Monitor tab",
  },
  { to: "/tokenomics", label: "Tokenomics", icon: BarChart3, title: undefined },
  { to: "/models", label: "Models", icon: Cpu, title: undefined },
  { to: "/requests", label: "Requests & Streaming", icon: Activity, title: undefined },
  { to: "/cost", label: "Cost", icon: Coins, title: undefined },
  { to: "/operations", label: "Operations", icon: Activity, title: undefined },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground">
        <Activity className="h-3.5 w-3.5" />
      </div>
      <div className="leading-tight">
        <div className="text-xs font-semibold">Foundry Monitor</div>
        <div className="text-[10px] text-muted-foreground">Operator console</div>
      </div>
    </div>
  );
}

function SidebarNav() {
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              title={item.title}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              )}
              activeProps={{
                className: "bg-secondary text-foreground",
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RootLayout() {
  return (
    <DashboardParamsProvider>
      <AppShell brand={<Brand />} sidebar={<SidebarNav />} header={<HeaderControls />}>
        <GlobalAlerts />
        <div className="p-4">
          <Outlet />
        </div>
      </AppShell>
    </DashboardParamsProvider>
  );
}

function NotFound() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="text-sm font-medium">Page not found</div>
      <Link to="/" className="text-xs text-primary underline">
        Back to Overview
      </Link>
    </div>
  );
}

function DefaultError({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="text-sm font-medium text-destructive">Something went wrong</div>
      <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
      <Button size="sm" variant="outline" onClick={() => router.invalidate()}>
        Reload
      </Button>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: DefaultError,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewView,
});

const tokenomicsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tokenomics",
  component: TokenomicsView,
});

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "models",
  component: ModelsView,
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "agents",
  component: () => <p>Agents are not applicable: this workload uses Azure OpenAI streaming APIs only.</p>,
});

const requestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "requests",
  component: RequestsView,
});
const costRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "cost",
  component: CostView,
});

const operationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "operations",
  component: OperationsView,
});

const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "platform",
  component: PlatformView,
});

const routeTree = rootRoute.addChildren([
  overviewRoute as AnyRoute,
  platformRoute as AnyRoute,
  tokenomicsRoute as AnyRoute,
  modelsRoute as AnyRoute,
  agentsRoute as AnyRoute,
  requestsRoute as AnyRoute,
  costRoute as AnyRoute,
  operationsRoute as AnyRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultErrorComponent: DefaultError,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
