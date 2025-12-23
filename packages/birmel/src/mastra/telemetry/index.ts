import { getConfig } from "../../config/index.js";
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
 * Create Mastra observability configuration with OtelExporter for Tempo.
 * DefaultExporter is automatically included when storage is configured.
 */
export function getMastraObservability() {
  const config = getConfig();

  return {
    default: { enabled: true },
    configs: {
      production: {
        serviceName: config.telemetry.serviceName,
        exporters: [
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
  };
}
