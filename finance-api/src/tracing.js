// OpenTelemetry tracing + pino structured logging for finance-api.
// Must be imported BEFORE express or any instrumented library.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import pino from "pino";

const serviceName = process.env.OTEL_SERVICE_NAME || "finance-api";

export async function initTracing() {
  const resource = new Resource({ [ATTR_SERVICE_NAME]: serviceName });
  const spanProcessors = [];

  // OTLP exporter (Jaeger / any OTLP collector)
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    spanProcessors.push(new BatchSpanProcessor(
      new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    ));
  }

  // Azure App Insights exporter (conditional)
  const aiConnStr = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (aiConnStr) {
    try {
      const { AzureMonitorTraceExporter } = await import("@azure/monitor-opentelemetry-exporter");
      spanProcessors.push(new BatchSpanProcessor(
        new AzureMonitorTraceExporter({ connectionString: aiConnStr })
      ));
    } catch {
      // @azure/monitor-opentelemetry-exporter not installed — skip
    }
  }

  const sdk = new NodeSDK({
    resource,
    spanProcessors,
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } }),
    ],
  });

  sdk.start();

  const shutdown = () => sdk.shutdown().catch(() => {});
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export function createLogger() {
  const level = process.env.LOG_LEVEL || "info";
  const transport = process.env.LOG_PRETTY === "true"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined;
  return pino({ level, transport });
}
