import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod/v4";

/** Resolve per activity; prod keeps cadence mail until its rollout is enabled. */
export async function dailyReportNotificationsConfig(stage: string) {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
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
