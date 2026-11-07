import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod/v4";

/** Resolve per activity; an explicit false retains cadence mail. */
export async function dailyReportNotificationsConfig(stage: string) {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "temporal-daily-report-notifications-enabled",
          stage === "prod" ? "prod" : "beta",
        ),
        names: { flag: "temporal-daily-report-notifications-enabled" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: `temporal-reports-${stage}`,
        attributes: { stage },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
  });
  return resolver.get("enabled");
}
