import { z } from "zod";

const BooleanTextSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const EnvironmentSchema = z
  .object({
    ALERTMANAGER_URL: z.url(),
    ALERT_DASHBOARD_WEBHOOK_TOKEN: z.string().min(32),
    DATABASE_URL: z.string().min(1),
    EMAIL_ENABLED: BooleanTextSchema.default(false),
    GRAFANA_PROMETHEUS_DATASOURCE_UID: z.string().min(1).default("prometheus"),
    GRAFANA_LOKI_DATASOURCE_UID: z.string().min(1).default("loki"),
    GRAFANA_TEMPO_DATASOURCE_UID: z.string().min(1).default("tempo"),
    GRAFANA_API_KEY: z.string().min(1),
    GRAFANA_URL: z.url(),
    PROMETHEUS_GENERATOR_HOSTS: z
      .string()
      .min(1)
      .default("prometheus.tailnet-1a49.ts.net"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(7341),
    POSTAL_API_KEY: z.string().min(1).optional(),
    POSTAL_FROM: z.email().optional(),
    POSTAL_HOST: z.url().optional(),
    POSTAL_HOST_HEADER: z.string().min(1).optional(),
    POSTAL_TO: z.email().optional(),
    TELEMETRY_ENABLED: BooleanTextSchema.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default("alert-dashboard"),
  })
  .superRefine((value, context) => {
    if (
      value.TELEMETRY_ENABLED &&
      value.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "OTEL_EXPORTER_OTLP_ENDPOINT is required when TELEMETRY_ENABLED=true",
        path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
      });
    }
    if (!value.EMAIL_ENABLED) return;
    for (const key of [
      "POSTAL_API_KEY",
      "POSTAL_FROM",
      "POSTAL_HOST",
      "POSTAL_TO",
    ] as const) {
      if (value[key] === undefined) {
        context.addIssue({
          code: "custom",
          message: `${key} is required when EMAIL_ENABLED=true`,
          path: [key],
        });
      }
    }
  });

export type AlertDashboardConfig = z.infer<typeof EnvironmentSchema>;

export function readConfig(
  environment: Record<string, string | undefined>,
): AlertDashboardConfig {
  return EnvironmentSchema.parse(environment);
}
