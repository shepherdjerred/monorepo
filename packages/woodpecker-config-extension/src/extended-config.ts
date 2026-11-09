import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import type { WoodpeckerBooleanFlagKey } from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import { z } from "zod";

const FLAG: WoodpeckerBooleanFlagKey = "woodpecker-extended-verify-enabled";

/**
 * Whether a signed `CI_EXTENDED_REQUEST` manual pipeline may run the extended
 * test tier. Off until the extension image and the Temporal dispatcher run
 * the same revision; an unavailable flag keeps the declared default, so the
 * lane fails closed rather than running on a guess.
 */
export async function extendedVerifyConfig() {
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
        targetingKey: "woodpecker-extended-verify",
        attributes: { stage: "prod" },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn(
          "Extended verification flag unavailable; refusing the request",
        );
      },
    },
  });
  return resolver.get("enabled");
}
