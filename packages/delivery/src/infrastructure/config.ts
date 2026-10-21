import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";
import { PrincipalSchema } from "#shared/contract.ts";

export const MachineCredentialSchema = z
  .object({
    token: z.string().min(32),
    principal: PrincipalSchema.refine(
      (value) => value.kind === "machine" && !value.scopes.includes("approve"),
      "Machines cannot approve releases",
    ),
  })
  .strict();
export const BootstrapSchema = z
  .object({
    DATABASE_URL: z.url(),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(7353),
    PUBLIC_ORIGIN: z.url().default("http://localhost:7353"),
    WOODPECKER_URL: z.url().default("https://woodpecker.sjer.red"),
    WOODPECKER_REPO_ID: z.coerce.number().int().positive().default(1),
    WOODPECKER_TOKEN: z.string().min(1).optional(),
    ARGOCD_SERVER_URL: z.url().default("https://argocd.sjer.red"),
    ARGOCD_RECOVERY_TOKEN: z.string().min(1).optional(),
    DELIVERY_GH_TOKEN: z.string().min(1).optional(),
    DELIVERY_FORUM_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    DELIVERY_FORUM_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    DELIVERY_FORUM_OBSERVATION_TOKEN: z.string().min(1).optional(),
    DELIVERY_TRMNL_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    TRMNL_API_KEY: z.string().min(1).optional(),
    DELIVERY_MACHINE_CREDENTIALS: z
      .string()
      .transform((value, context) => {
        try {
          const raw: unknown = JSON.parse(value);
          return z.array(MachineCredentialSchema).parse(raw);
        } catch {
          context.addIssue({
            code: "custom",
            message: "Invalid machine credential configuration",
          });
          return z.NEVER;
        }
      })
      .default([]),
    ENVIRONMENT: z
      .enum(["production", "beta", "development", "test"])
      .default("production"),
  })
  .superRefine((value, context) => {
    const trmnl = [
      value.DELIVERY_TRMNL_S3_ACCESS_KEY_ID,
      value.DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY,
      value.TRMNL_API_KEY,
    ];
    if (trmnl.some((field) => field !== undefined) && trmnl.includes(undefined))
      context.addIssue({
        code: "custom",
        message:
          "TRMNL archive reader and fixed plugin API key must be provisioned together",
      });
    if (
      (value.DELIVERY_FORUM_S3_ACCESS_KEY_ID === undefined) !==
      (value.DELIVERY_FORUM_S3_SECRET_ACCESS_KEY === undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Forum archive reader credentials must be provisioned together",
      });
  });
const StringListSchema = z.string().transform((value, context) => {
  try {
    const raw: unknown = JSON.parse(value);
    return z.array(z.string().min(1)).parse(raw);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Expected a JSON array of nonempty strings",
    });
    return z.NEVER;
  }
});
export function behaviorConfig(stage: string) {
  return defineConfig({
    definition: {
      writesEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "delivery-writes-enabled" },
      },
      enabledEnvironments: {
        schema: StringListSchema,
        sources: ["flag", "default"],
        default: "[]",
        names: { flag: "delivery-enabled-environments" },
      },
      operatorLogins: {
        schema: StringListSchema,
        sources: ["flag", "default"],
        default: "[]",
        names: { flag: "delivery-operator-logins" },
      },
      enrichmentSources: {
        schema: StringListSchema,
        sources: ["flag", "default"],
        default: "[]",
        names: { flag: "delivery-enrichment-sources" },
      },
      /** Simultaneously owned deployments across the executor (model D10). */
      executorConcurrency: {
        schema: z.number().int().min(1).max(64),
        sources: ["flag", "default"],
        default: 4,
        names: { flag: "delivery-executor-concurrency" },
      },
      /** How long an owned deployment stays provably owned without renewal (model D7). */
      leaseSeconds: {
        schema: z.number().int().min(60).max(7200),
        sources: ["flag", "default"],
        default: 900,
        names: { flag: "delivery-lease-seconds" },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "delivery",
        attributes: { stage },
        requireFreshSnapshot: true,
        kinds: {
          writesEnabled: "boolean",
          enabledEnvironments: "string",
          operatorLogins: "string",
          enrichmentSources: "string",
          executorConcurrency: "number",
          leaseSeconds: "number",
        },
      }),
    },
    hooks: {
      onSourceError: (key, source) => {
        console.warn(
          JSON.stringify({
            message: "delivery_config_source_error",
            key,
            source,
          }),
        );
      },
    },
  });
}
/** Operational bounds the record enforces at admission; typed configuration, never literals. */
export type DeliveryPolicy = {
  executorConcurrency: () => Promise<number>;
  leaseSeconds: () => Promise<number>;
};
export type RuntimeConfig = {
  publicOrigin: string;
  machineCredentials: z.infer<typeof MachineCredentialSchema>[];
  writesEnabled: () => Promise<boolean>;
  enabledEnvironments: () => Promise<string[]>;
  operatorLogins: () => Promise<string[]>;
  trustedProxyAddresses: () => Promise<string[]>;
};
