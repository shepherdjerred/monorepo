import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod/v4";

/**
 * Whether the Red Warfare recording archive may run. An unavailable flag
 * provider keeps it off even with a default-on declaration, since
 * an archive run marks recordings as safe for the plugin to delete.
 */
export async function rwfRecordingArchiveConfig() {
  const availability = { value: true };
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "the-storm-rwf-recording-archive-enabled",
        ),
        names: { flag: "the-storm-rwf-recording-archive-enabled" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "the-storm-rwf-recording-archive-prod",
        attributes: { environment: "prod" },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
        onUnavailable: () => {
          availability.value = false;
        },
      }),
    },
    hooks: {
      onSourceError: () => {
        availability.value = false;
      },
    },
  });
  const enabled = await resolver.get("enabled");
  return {
    enabled: availability.value && enabled.value,
    provenance: { enabled: enabled.source },
  };
}
