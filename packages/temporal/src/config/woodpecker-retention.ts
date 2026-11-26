import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { z } from "zod/v4";

export async function woodpeckerRetentionConfig() {
  const availability = { value: true };
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "woodpecker-log-retention-enabled" },
      },
      days: {
        schema: flagValueSchema("woodpecker-log-retention-days"),
        sources: ["flag", "default"],
        default: 30,
        names: { flag: "woodpecker-log-retention-days" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "woodpecker-log-retention-prod",
        attributes: { environment: "prod" },
        kinds: {
          enabled: "boolean",
          days: flagValueKind("woodpecker-log-retention-days"),
        },
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
  const [enabled, days] = await Promise.all([
    resolver.get("enabled"),
    resolver.get("days"),
  ]);
  return {
    enabled: availability.value && enabled.value,
    days: days.value,
    provenance: { enabled: enabled.source, days: days.source },
  };
}
