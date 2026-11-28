import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod/v4";
import { resolveCurrentRemediationStage } from "./report-remediation.ts";

export const RENOVATE_PUBLISHING_FLAG = "temporal-renovate-publishing-enabled";

export async function renovatePublishingEnabled(
  stage = resolveCurrentRemediationStage(),
): Promise<boolean> {
  if (stage !== "prod") return false;
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(RENOVATE_PUBLISHING_FLAG, "prod"),
        names: { flag: RENOVATE_PUBLISHING_FLAG },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "temporal-renovate-publishing-prod",
        attributes: { stage },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
  });
  const resolved = await resolver.get("enabled");
  return resolved.source === "flag" && resolved.value;
}
