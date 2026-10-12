import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export async function sourceCacheConfig(branch: string) {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "woodpecker-source-cache-enabled" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: branch,
        attributes: {
          stage: branch.startsWith("ci-canary/") ? "beta" : "prod",
        },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn("Source cache flag unavailable; using ordinary checkout");
      },
    },
  });
  return resolver.get("enabled");
}
