import { expect, test, type Page } from "@playwright/test";

type ConsoleError = {
  text: string;
  url: string;
};

type ObservedErrors = {
  pageErrors: string[];
  consoleErrors: ConsoleError[];
};

const observed = new WeakMap<Page, ObservedErrors>();

test.beforeEach(async ({ page }) => {
  const errors: ObservedErrors = { pageErrors: [], consoleErrors: [] };
  observed.set(page, errors);

  page.on("pageerror", (error) => {
    errors.pageErrors.push(error.message);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    errors.consoleErrors.push({
      text: message.text(),
      url: message.location().url,
    });
  });
});

test.afterEach(async ({ page }) => {
  const errors = observed.get(page);
  if (!errors) return;

  const disallowedConsoleErrors = errors.consoleErrors.filter(
    (error) => !/favicon/i.test(error.url) && !/favicon/i.test(error.text),
  );

  expect(errors.pageErrors, "no uncaught page errors").toEqual([]);
  expect(disallowedConsoleErrors, "no browser console errors").toEqual([]);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByText("Couldn’t load this panel.")).toHaveCount(0);
});

test("app shell renders navigation, range controls, and mock source badge", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Foundry Monitor")).toBeVisible();
  const primaryNav = page.getByRole("complementary", { name: "Primary" }).first();
  await expect(primaryNav).toBeVisible();

  for (const linkName of ["Overview", "Platform Usage", "Tokenomics", "Models", "Agents", "Cost", "Operations"]) {
    await expect(primaryNav.getByRole("link", { name: linkName })).toBeVisible();
  }

  for (const preset of ["1h", "6h", "24h", "7d", "30d"]) {
    await expect(page.getByRole("button", { name: preset })).toBeVisible();
  }

  await expect(page.getByText("Bucket", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Model\s+All/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Agent\s+All/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Operation\s+All/i })).toBeVisible();
  await expect(page.getByText("Mock data")).toBeVisible();
  await expect(page.getByText("Mock", { exact: true })).toBeVisible();
  await expect(page.getByText("Authoritative usage", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Instrumented agent traces (subset)")).toBeVisible();
  await expect(page.getByText("Platform metrics (authoritative)").first()).toBeVisible();
  await expect(page.getByText("Agent traces (instrumented)").first()).toBeVisible();

  await expect(page.getByText("Calls", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Total tokens", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Est. cost", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Error rate", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".num").first()).toContainText(/[\d$]/);
});

test("all dashboard routes render their key operator content", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Overview").first()).toBeVisible();
  await expect(page.getByText("Authoritative usage", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Instrumented agent traces (subset)")).toBeVisible();
  await expect(page.getByText("Platform metrics (authoritative)").first()).toBeVisible();
  await expect(page.getByText("Agent traces (instrumented)").first()).toBeVisible();
  await expect(page.getByText("Total tokens", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".num").first()).toContainText(/[\d$]/);

  await page.getByRole("link", { name: "Platform Usage" }).click();
  await expect(page.getByText("Authoritative platform metrics — all traffic")).toBeVisible();
  await expect(page.getByText("Platform metrics (authoritative)").first()).toBeVisible();
  await expect(page.getByText("Requests", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Total tokens", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Est. cost", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".num").first()).toContainText(/[\d$]/);
  await expect(page.getByText("Tokens over time")).toBeVisible();
  await expect(page.getByText("Requests over time")).toBeVisible();
  await expect(page.getByText("By model")).toBeVisible();
  await expect(page.getByRole("cell", { name: /gpt-5\.4-/ }).first()).toBeVisible();

  await page.getByRole("link", { name: "Tokenomics" }).click();
  await expect(page.getByText("Tokens over time")).toBeVisible();
  await expect(page.getByText("Tokens by model")).toBeVisible();
  await expect(page.getByText("Top consumers")).toBeVisible();
  await expect(page.getByRole("cell", { name: /gpt-5\.4-/ }).first()).toBeVisible();

  await page.getByRole("link", { name: "Models" }).click();
  await expect(page.getByText("Model comparison")).toBeVisible();
  await expect(page.getByText("Models").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /gpt-5\.4-/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Calls/ }).first()).toBeVisible();
  await expect(page.getByText(/Models · Page 1 of \d+ · \d+ rows/)).toBeVisible();

  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByText("Operation mix by agent")).toBeVisible();
  await expect(page.getByText("Activity over time")).toBeVisible();
  await expect(page.getByText("Agents").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /\(unattributed\)|WeatherAgent/ }).first()).toBeVisible();

  await page.getByRole("link", { name: "Cost" }).click();
  await expect(page.getByText("Estimated cost (authoritative · range)")).toBeVisible();
  await expect(page.getByText("Platform metrics (authoritative)").first()).toBeVisible();
  await expect(page.getByText("Estimated-from-traces & billed (Cost Management)")).toBeVisible();
  await expect(page.getByText("Est. cost (range)")).toBeVisible();
  await expect(page.getByText("Est. cost (range, traces)")).toBeVisible();
  await expect(page.getByText("Billed (MTD)")).toBeVisible();
  await expect(page.getByText("Estimated", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("(token × price)")).toBeVisible();
  await expect(page.getByText("Billed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("(Cost Mgmt)")).toBeVisible();
  await expect(page.getByText("Cost detail")).toBeVisible();

  await page.getByRole("link", { name: "Operations" }).click();
  await expect(page.getByText("Latency percentiles")).toBeVisible();
  await expect(page.getByText("Operations").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "chat" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "invoke_agent" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "execute_tool" }).first()).toBeVisible();
  await expect(page.getByText("Recent errors").first()).toBeVisible();
  await expect(page.getByText(/Recent errors · Page 1 of \d+ · \d+ rows/)).toBeVisible();
});

test("platform usage route renders authoritative metrics and pages the by-model table", async ({ page }) => {
  await page.route("**/api/platform/by-model?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const pageParam = Number(requestUrl.searchParams.get("page") ?? "1");
    const pageSizeParam = Number(requestUrl.searchParams.get("pageSize") ?? "25");
    const sort = requestUrl.searchParams.get("sort") ?? "requests";
    const dir = requestUrl.searchParams.get("dir") ?? "desc";
    const allRows = Array.from({ length: 30 }, (_, i) => ({
      model: `gpt-5.4-platform-e2e-${String(i).padStart(2, "0")}`,
      requests: i + 1,
      inputTokens: 100_000 + i,
      outputTokens: 50_000 + i,
      totalTokens: 150_000 + i * 2,
      estCost: (i + 1) / 10,
    }));

    allRows.sort((a, b) => {
      const left = a[sort as keyof typeof a];
      const right = b[sort as keyof typeof b];
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return dir === "asc" ? result : -result;
    });

    const start = (pageParam - 1) * pageSizeParam;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        meta: {
          source: "mock",
          usageSource: "platform-metrics",
          status: "ok",
          dataAsOf: "2026-04-08T12:00:00.000Z",
          queryTimeMs: 1,
          granularityUsed: "1h",
          timeRange: {
            from: "2026-04-07T12:00:00.000Z",
            to: "2026-04-08T12:00:00.000Z",
          },
          warnings: [],
          costAvailable: true,
          priceSource: "estimated · e2e",
          refreshIntervalMs: 20_000,
          schemaVersion: 1,
        },
        data: {
          rows: allRows.slice(start, start + pageSizeParam),
          total: allRows.length,
        },
      }),
    });
  });

  await page.goto("/platform");

  await expect(page.getByText("Platform metrics (authoritative)").first()).toBeVisible();
  await expect(page.getByText("Requests", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Total tokens", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Est. cost", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".num").first()).toContainText(/[\d$]/);
  await expect(page.getByText("Tokens over time")).toBeVisible();
  await expect(page.getByText("Requests over time")).toBeVisible();
  await expect(page.getByText("Models (platform metrics) · Page 1 of 2 · 30 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "gpt-5.4-platform-e2e-29" }).first()).toBeVisible();

  await page.getByRole("button", { name: /^Requests/ }).click();
  await expect(page.getByRole("cell", { name: "gpt-5.4-platform-e2e-00" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Models (platform metrics) · Page 2 of 2 · 30 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "gpt-5.4-platform-e2e-25" }).first()).toBeVisible();
});

test("time-range and metadata-backed filters update without errors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Calls", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "7d" }).click();
  await expect(page.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Total tokens", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".num").first()).toContainText(/[\d$]/);

  await page.getByRole("button", { name: /Model\s+All/i }).click();
  await expect(page.getByRole("menuitem", { name: /gpt-5\.4-mini-2026-03-17/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /gpt-5\.4-nano-2026-03-17/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /gpt-5\.4-mini-2026-03-17/ }).press("Escape");
  await expect(page.getByRole("menuitem", { name: /gpt-5\.4-mini-2026-03-17/ })).toBeHidden();

  await page.getByRole("button", { name: /Agent\s+All/i }).click();
  await expect(page.getByRole("menuitem", { name: "WeatherAgent" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "(unattributed)" })).toBeVisible();
  await page.getByRole("menuitem", { name: "WeatherAgent" }).press("Escape");
  await expect(page.getByRole("menuitem", { name: "WeatherAgent" })).toBeHidden();

  await page.getByRole("button", { name: /Operation\s+All/i }).click();
  await expect(page.getByRole("menuitem", { name: "chat" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "invoke_agent" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "execute_tool" })).toBeVisible();
});

test("models table sorting and pagination controls work with paged data", async ({ page }) => {
  await page.route("**/api/models?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const pageParam = Number(requestUrl.searchParams.get("page") ?? "1");
    const pageSizeParam = Number(requestUrl.searchParams.get("pageSize") ?? "25");
    const sort = requestUrl.searchParams.get("sort") ?? "calls";
    const dir = requestUrl.searchParams.get("dir") ?? "desc";
    const allRows = Array.from({ length: 30 }, (_, i) => ({
      model: `gpt-5.4-e2e-${String(i).padStart(2, "0")}`,
      calls: i + 1,
      input: 10_000 + i,
      output: 5_000 + i,
      cached: 1_000 + i,
      total: 15_000 + i * 2,
      estCost: (i + 1) / 100,
      p50Ms: 100 + i,
      p90Ms: 200 + i,
      p95Ms: 300 + i,
      p99Ms: 400 + i,
      errorRate: i / 1_000,
      avgDurationMs: 150 + i,
    }));

    allRows.sort((a, b) => {
      const left = a[sort as keyof typeof a];
      const right = b[sort as keyof typeof b];
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return dir === "asc" ? result : -result;
    });

    const start = (pageParam - 1) * pageSizeParam;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        meta: {
          source: "mock",
          status: "ok",
          dataAsOf: "2026-04-08T12:00:00.000Z",
          queryTimeMs: 1,
          granularityUsed: "1h",
          timeRange: {
            from: "2026-04-07T12:00:00.000Z",
            to: "2026-04-08T12:00:00.000Z",
          },
          warnings: [],
          costAvailable: true,
          priceSource: "estimated · e2e",
          refreshIntervalMs: 20_000,
          schemaVersion: 1,
        },
        data: {
          rows: allRows.slice(start, start + pageSizeParam),
          total: allRows.length,
        },
      }),
    });
  });

  await page.goto("/models");
  await expect(page.getByText("Models · Page 1 of 2 · 30 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "gpt-5.4-e2e-29" }).first()).toBeVisible();

  await page.getByRole("button", { name: /^Calls/ }).click();
  await expect(page.getByRole("cell", { name: "gpt-5.4-e2e-00" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Models · Page 2 of 2 · 30 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "gpt-5.4-e2e-25" }).first()).toBeVisible();
});

test("operations recent-errors table pages through 30d mock failures", async ({ page }) => {
  await page.goto("/operations");
  await page.getByRole("button", { name: "30d" }).click();
  await expect(page.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Recent errors · Page 1 of [2-9]\d* · \d+ rows/)).toBeVisible();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText(/Recent errors · Page 2 of \d+ · \d+ rows/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /rate_limit|server_5xx|other/ }).first()).toBeVisible();
});

test("no-data responses render empty states instead of blank panels or crashes", async ({ page }) => {
  await page.route("**/api/models?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("preset") !== "1h") {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        meta: {
          source: "mock",
          status: "empty",
          dataAsOf: "2026-04-08T12:00:00.000Z",
          queryTimeMs: 1,
          granularityUsed: "5m",
          timeRange: {
            from: "2026-04-08T11:00:00.000Z",
            to: "2026-04-08T12:00:00.000Z",
          },
          warnings: [],
          costAvailable: true,
          priceSource: "estimated · e2e",
          refreshIntervalMs: 20_000,
          schemaVersion: 1,
        },
        data: {
          rows: [],
          total: 0,
        },
      }),
    });
  });

  await page.goto("/models");
  await expect(page.getByRole("cell", { name: /gpt-5\.4-/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "1h" }).click();

  await expect(page.getByText("No activity in this range.").first()).toBeVisible();
  await expect(page.getByText("No rows in this range.")).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
});
