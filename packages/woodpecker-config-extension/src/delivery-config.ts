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

/**
 * Producers register under the Delivery v2 catalog's owners only after the
 * cutover window flips this with publication (window step 8). WP4 deletes it.
 */
export async function deliveryCatalogV2Enabled(
  branch: string,
): Promise<boolean> {
  return deliveryFlagConfig(
    branch,
    "woodpecker-delivery-catalog-v2-enabled",
    "prod",
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
