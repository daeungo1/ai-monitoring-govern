import { StreamingCollector } from "./streaming.js";
import type { PriceCard, RequestContext, RequestEvent } from "./accounting.js";
import type { fixtures } from "./fixtures.js";

export function replayFixture(fixture: typeof fixtures[number], context: RequestContext, price: PriceCard): RequestEvent {
  const collector = new StreamingCollector(context, price);
  if ("chunks" in fixture) {
    fixture.chunks.forEach((chunk, index) => collector.accept(chunk, 10 + index * 5));
    return fixture.cancelled ? collector.finish(25, { kind: "cancelled", error: new Error("Fixture cancellation.") })
      : collector.finish(25);
  }
  if ("response" in fixture) {
    collector.accept({ choices: [{ delta: { content: "safe fixture" } }] }, 10);
    collector.accept(fixture.response, 20);
    return collector.finish(25);
  }
  return collector.finish(25, { kind: "error", error: fixture.error });
}
