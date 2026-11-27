import { MailboxAddressSchema } from "@shepherdjerred/ops-model/email/mailbox.ts";
import { z } from "zod";

const BooleanTextSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const EnvironmentSchema = z
  .object({
    ALERTMANAGER_URL: z.url(),
    ALERT_DASHBOARD_WEBHOOK_TOKEN: z.string().min(32),
    BRIM_API_URL: z.httpUrl().optional(),
    BRIM_HUB_TOKEN: z.string().min(32).optional(),
    BRIM_INGRESS_IDENTITY_DIR: z.string().min(1).optional(),
    BRIM_OPERATOR_LOGINS: z
      .string()
      .refine((value) => value.split(",").some((login) => login.trim() !== ""))
      .optional(),
    DATABASE_URL: z.string().min(1),
    DAILY_DIGEST_QUIET_CLEAR: BooleanTextSchema.default(true),
    EMAIL_ENABLED: BooleanTextSchema.default(false),
    GRAFANA_PROMETHEUS_DATASOURCE_UID: z.string().min(1).default("prometheus"),
    GRAFANA_LOKI_DATASOURCE_UID: z.string().min(1).default("loki"),
    GRAFANA_TEMPO_DATASOURCE_UID: z.string().min(1).default("tempo"),
    GRAFANA_API_KEY: z.string().min(1),
    GRAFANA_URL: z.url(),
    HOMEASSISTANT_TOKEN: z.string().min(1).optional(),
    HOMEASSISTANT_URL: z.url().optional(),
    PROMETHEUS_GENERATOR_HOSTS: z
      .string()
      .min(1)
      .default("prometheus.tailnet-1a49.ts.net"),
    HOST: z.string().min(1).default("0.0.0.0"),
    OPS_INGEST_TOKEN: z.string().min(32),
    PROMOTION_STATUS_URL: z
      .url()
      .default("http://promotion-status.temporal.svc.cluster.local:7343"),
    PROMETHEUS_URL: z.url(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(7341),
    MAIL_API_TOKEN: z.string().min(1).optional(),
    MAIL_API_URL: z.url().optional(),
    MAIL_FROM: MailboxAddressSchema.optional(),
    MAIL_TO: z.email().optional(),
    MAIL_DIGEST_FROM: MailboxAddressSchema.optional(),
    MAIL_DIGEST_TO: z.email().optional(),
    TELEMETRY_ENABLED: BooleanTextSchema.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default("alert-dashboard"),
    TEMPO_URL: z.url().optional(),
    TRACES_INDEX_DB_PATH: z
      .string()
      .min(1)
      .default("/data/llm-traces-index.db"),
    LLM_ARCHIVE_S3_BUCKET: z.string().min(1).optional(),
    LLM_ARCHIVE_S3_PREFIX: z.string().min(1).default("llm"),
    S3_ENDPOINT: z.url().optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const brimKeys = [
      "BRIM_API_URL",
      "BRIM_HUB_TOKEN",
      "BRIM_INGRESS_IDENTITY_DIR",
      "BRIM_OPERATOR_LOGINS",
    ] as const;
    if (brimKeys.some((key) => value[key] !== undefined)) {
      for (const key of brimKeys) {
        if (value[key] === undefined || value[key].trim() === "") {
          context.addIssue({
            code: "custom",
            message: `${key} is required when the Brim proxy is configured`,
            path: [key],
          });
        }
      }
    }
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
    const archiveKeys = [
      "LLM_ARCHIVE_S3_BUCKET",
      "S3_ENDPOINT",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ] as const;
    const anyArchiveSet = archiveKeys.some((key) => value[key] !== undefined);
    if (anyArchiveSet) {
      for (const key of archiveKeys) {
        if (value[key] === undefined) {
          context.addIssue({
            code: "custom",
            message: `${key} is required when any LLM archive S3 setting is provided`,
            path: [key],
          });
        }
      }
    }
    if (!value.EMAIL_ENABLED) return;
    for (const key of [
      "MAIL_API_TOKEN",
      "MAIL_API_URL",
      "MAIL_FROM",
      "MAIL_TO",
    ] as const) {
      if (value[key] === undefined) {
        context.addIssue({
          code: "custom",
          message: `${key} is required when EMAIL_ENABLED=true`,
          path: [key],
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    MAIL_DIGEST_FROM: value.MAIL_DIGEST_FROM ?? value.MAIL_FROM,
    MAIL_DIGEST_TO: value.MAIL_DIGEST_TO ?? value.MAIL_TO,
  }));

export type AlertDashboardConfig = z.infer<typeof EnvironmentSchema>;

export function readConfig(
  environment: Record<string, string | undefined>,
): AlertDashboardConfig {
  return EnvironmentSchema.parse(environment);
}
