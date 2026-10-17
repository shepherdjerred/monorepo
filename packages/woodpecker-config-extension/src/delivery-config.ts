import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";
import type { WoodpeckerBooleanFlagKey } from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";

export async function deliveryPublicationEnabled(
  branch: string,
): Promise<boolean> {
  return deliveryFlagConfig(
    branch,
    "woodpecker-delivery-publication-enabled",
    "prod",
  ).value("enabled");
}

export async function deliveryStaticArchivesEnabled(
  branch: string,
): Promise<boolean> {
  return deliveryFlagConfig(
    branch,
    "woodpecker-delivery-static-archives-enabled",
    branch.startsWith("ci-canary/") ? "beta" : "prod",
  ).value("enabled");
}

function deliveryFlagConfig(
  branch: string,
  flag: WoodpeckerBooleanFlagKey,
  stage: string,
) {
  const config = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey: branch,
        attributes: { stage },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
  });
  return config;
}
