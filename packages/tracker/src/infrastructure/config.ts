import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export const BootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(7351),
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1).default("tracker-attachments"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  BUGSINK_DSN: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  ENVIRONMENT: z
    .enum(["production", "beta", "development", "test"])
    .default("production"),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

export function behaviorConfig(stage: string) {
  return defineConfig({
    definition: {
      writesEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "tracker-writes-enabled" },
      },
      telemetryEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "tracker-telemetry-enabled" },
      },
      attachmentMaxBytes: {
        schema: z.coerce
          .number()
          .int()
          .positive()
          .max(100 * 1024 * 1024),
        sources: ["flag", "default"],
        default: 25 * 1024 * 1024,
        names: { flag: "tracker-attachment-max-bytes" },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "tracker",
        attributes: { stage },
        kinds: {
          writesEnabled: "boolean",
          telemetryEnabled: "boolean",
          attachmentMaxBytes: "string",
        },
      }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(
          JSON.stringify({
            message: "config_source_error",
            key,
            source,
            error: message,
          }),
        );
      },
    },
  });
}
