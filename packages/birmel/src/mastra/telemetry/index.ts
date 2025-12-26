import { getConfig } from "../../config/index.js";
import { Observability, DefaultExporter } from "@mastra/observability";
import { OtelExporter } from "@mastra/otel-exporter";

export type TelemetryConfig = {
  enabled: boolean;
  serviceName: string;
  export?: {
    type: "otlp" | "console";
    endpoint?: string;
  };
};

/**
 * Get legacy telemetry config for manual OpenTelemetry setup
 * @deprecated Use getMastraObservability() for Mastra's built-in tracing
 */
export function getTelemetryConfig(): TelemetryConfig | undefined {
  const config = getConfig();

  if (!config.telemetry.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    serviceName: config.telemetry.serviceName,
    export: {
      type: "otlp",
      endpoint: config.telemetry.otlpEndpoint,
    },
  };
}

/**
 * Create Mastra observability instance.
 * Uses both DefaultExporter (for Mastra Studio) and OtelExporter (for Tempo).
 */
export function getMastraObservability() {
  const config = getConfig();

  return new Observability({
    configs: {
      default: {
        serviceName: config.telemetry.serviceName,
        exporters: [
          new DefaultExporter(),
          new OtelExporter({
            provider: {
              custom: {
                endpoint: `${config.telemetry.otlpEndpoint}/v1/traces`,
                protocol: "http/protobuf",
              },
            },
          }),
        ],
      },
    },
  });
}
