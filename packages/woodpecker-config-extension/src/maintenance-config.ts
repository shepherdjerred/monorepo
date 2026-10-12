import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export async function maintenanceConfig(manual = false) {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "woodpecker-maintenance-lanes-enabled" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: manual
          ? "woodpecker-maintenance-manual"
          : "woodpecker-maintenance-prod",
        attributes: { stage: manual ? "beta" : "prod" },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn(
          "Maintenance flag unavailable; retaining main maintenance",
        );
      },
    },
  });
  return resolver.get("enabled");
}
