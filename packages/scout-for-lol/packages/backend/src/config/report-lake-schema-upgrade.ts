import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-lake-schema-upgrade");

/** Resolve only when upgrading a known legacy lake, never on new-schema reads. */
export async function reportLakeSchemaUpgradeEnabled(): Promise<boolean> {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "scout-report-lake-schema-upgrade-enabled" },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "scout-report-lake",
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: (_key, _source, message) => {
        logger.warn(
          "Schema upgrade control unavailable; retaining legacy layout",
          { message },
        );
      },
    },
  });
  return await resolver.value("enabled");
}
