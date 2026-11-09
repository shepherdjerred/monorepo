import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

/**
 * Production control for the nightly extended test tier dispatch. The flag
 * defaults off: the Temporal worker and the config extension lane deploy from
 * the same change, and dispatching before both run would only record
 * failures.
 */
export async function ciExtendedVerifyEnabled() {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "ci-extended-verify-dispatch-enabled" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "ci-extended-verify-prod",
        attributes: { environment: "prod", stage: "prod" },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn(
          "CI extended verify flag unavailable; nightly dispatch disabled",
        );
      },
    },
  });
  const result = await resolver.get("enabled");
  return result.value;
}
