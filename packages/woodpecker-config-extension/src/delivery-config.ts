import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export async function deliveryPublicationEnabled(
  branch: string,
): Promise<boolean> {
  const config = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "woodpecker-delivery-publication-enabled" },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey: branch,
        attributes: { stage: "prod" },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
  });
  return config.value("enabled");
}
