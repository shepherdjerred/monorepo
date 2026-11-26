import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import type { WoodpeckerBooleanFlagKey } from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import { z } from "zod";

const FLAG: WoodpeckerBooleanFlagKey = "woodpecker-supersede-main-enabled";

/**
 * Controls pre-publication `push main` supersession (`AI-823`). Enabled by
 * default in production and beta; if the Flags snapshot is stale or unreachable,
 * `resolved.source` falls back to `"default"` and we return `false` so an
 * outage leaves active `main` pipelines untouched.
 */
export async function supersedeMainConfig() {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(FLAG),
        names: { flag: FLAG },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "woodpecker-supersede-main",
        attributes: { stage: "prod" },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn(
          "Main supersession flag unavailable; skipping push main cancellation",
        );
      },
    },
  });
  const resolved = await resolver.get("enabled");
  return resolved.source === "flag" ? resolved : { ...resolved, value: false };
}

export async function supersedeMainEnabled(): Promise<boolean> {
  try {
    const result = await supersedeMainConfig();
    return result.value;
  } catch (error) {
    console.warn(
      "Main supersession flag evaluation failed; skipping push main cancellation",
      error,
    );
    return false;
  }
}
