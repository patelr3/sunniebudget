// OpenTelemetry SDK initialization — must be imported FIRST (before Express).
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";

let traceExporter;
const connStr = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connStr) {
  const mod = await import("@azure/monitor-opentelemetry-exporter");
  const AzureMonitorTraceExporter = mod.AzureMonitorTraceExporter;
  traceExporter = new AzureMonitorTraceExporter({ connectionString: connStr });
  console.log("[tracing] Azure Monitor exporter configured");
} else {
  traceExporter = new ConsoleSpanExporter();
  console.log("[tracing] Console exporter (no APPLICATIONINSIGHTS_CONNECTION_STRING)");
}

const sdk = new NodeSDK({
  serviceName: "mcp-server",
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": { enabled: true },
      "@opentelemetry/instrumentation-express": { enabled: true },
      // Disable noisy/unused ones
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
    }),
  ],
});

sdk.start();

process.on("SIGTERM", () => sdk.shutdown().catch(console.error));
process.on("SIGINT", () => sdk.shutdown().catch(console.error));

export { trace, context, SpanStatusCode } from "@opentelemetry/api";
