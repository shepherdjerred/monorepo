import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export async function ciMaintenanceEnabled() {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "ci-maintenance-dispatch-enabled" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "ci-maintenance-prod",
        attributes: { environment: "prod" },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn("CI maintenance flag unavailable; dispatch disabled");
      },
    },
  });
  const result = await resolver.get("enabled");
  return result.value;
}
