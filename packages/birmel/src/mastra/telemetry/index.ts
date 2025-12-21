import { getConfig } from "../../config/index.js";

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  export?: {
    type: "otlp" | "console";
    endpoint?: string;
  };
}

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
