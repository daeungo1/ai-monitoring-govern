import { describe, expect, it } from "vitest";
import { CommonQuerySchema, RecentErrorsQuerySchema, TableEndpointQuerySchema } from "../../shared/contracts/index.js";

describe("query parameter schemas", () => {
  it("accepts valid common query params and normalizes repeated filters", () => {
    const parsed = CommonQuerySchema.parse({
      preset: "24h",
      to: "2026-04-08T12:00:00.000Z",
      granularity: "15m",
      model: "gpt-5.4-mini,gpt-5.4-nano",
      agent: ["WeatherAgent", "TravelBookingAgent"],
      operation: "chat,execute_tool",
    });

    expect(parsed.granularity).toBe("15m");
    expect(parsed.model).toEqual(["gpt-5.4-mini", "gpt-5.4-nano"]);
    expect(parsed.agent).toEqual(["WeatherAgent", "TravelBookingAgent"]);
    expect(parsed.operation).toEqual(["chat", "execute_tool"]);
  });

  it("accepts valid table and recent-errors params", () => {
    const table = TableEndpointQuerySchema.parse({
      from: "2026-04-08T00:00:00.000Z",
      to: "2026-04-08T12:00:00.000Z",
      page: "2",
      pageSize: "50",
      topN: "10",
      dir: "asc",
    });
    const recentErrors = RecentErrorsQuerySchema.parse({
      preset: "7d",
      to: "2026-04-08T12:00:00.000Z",
      includeRaw: "true",
    });

    expect(table.page).toBe(2);
    expect(table.pageSize).toBe(50);
    expect(table.dir).toBe("asc");
    expect(recentErrors.includeRaw).toBe(true);
  });

  it("rejects an invalid preset", () => {
    expect(CommonQuerySchema.safeParse({ preset: "2h" }).success).toBe(false);
  });

  it("rejects negative table pages", () => {
    expect(TableEndpointQuerySchema.safeParse({ page: "-1" }).success).toBe(false);
  });

  it("rejects unknown operation filters", () => {
    expect(CommonQuerySchema.safeParse({ operation: "unknown" }).success).toBe(false);
  });
});
