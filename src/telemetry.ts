import { AzureMonitorTraceExporter } from "@azure/monitor-opentelemetry-exporter";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { toAttributes, type RequestEvent } from "./accounting.js";

export class Telemetry {
  private readonly provider: NodeTracerProvider;
  private exportFailed = false;

  constructor(connectionString: string) {
    const exporter = new AzureMonitorTraceExporter({ connectionString, disableOfflineStorage: true });
    this.provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ "service.name": "aoai-api-monitoring-demo" }),
      spanProcessors: [new BatchSpanProcessor({
        export: (spans, callback) => exporter.export(spans, result => {
          if (result.code !== 0) {
            this.exportFailed = true;
            console.error("Azure Monitor export failed. Check ingestion access and connection settings.");
          }
          callback(result);
        }),
        shutdown: () => exporter.shutdown(),
      }, { scheduledDelayMillis: 1000, exportTimeoutMillis: 30000 })],
    });
  }

  emit(event: RequestEvent): void {
    const end = Date.now();
    const span = this.provider.getTracer("aoai-demo", "1.0.0").startSpan("chat.completions",
      { kind: SpanKind.CLIENT, startTime: end - event.latencyMs, attributes: toAttributes(event) });
    span.setStatus({
      code: event.outcome === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    span.end(end);
  }

  async close(): Promise<void> {
    await this.provider.forceFlush();
    await this.provider.shutdown();
    if (this.exportFailed) throw new Error("Telemetry export did not succeed; do not claim ingestion verified.");
  }
}
