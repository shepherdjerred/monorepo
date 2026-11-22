import { Context } from "@temporalio/activity";
import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod/v4";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";

export const REPORT_AUTO_REMEDIATION_FLAG_KEY =
  "temporal-report-auto-remediation-enabled";

/** Resolve per remediation activity; an explicit false skips LLM/PR follow-through. */
export async function reportRemediationConfig(stage: string) {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          REPORT_AUTO_REMEDIATION_FLAG_KEY,
          stage === "prod" ? "prod" : "beta",
        ),
        names: { flag: REPORT_AUTO_REMEDIATION_FLAG_KEY },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: `temporal-remediation-${stage}`,
        attributes: { stage },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(`[Config] ${key} ${source}: ${message}`);
      },
    },
  });
  return resolver.get("enabled");
}

export function resolveCurrentRemediationStage(): string {
  try {
    return parseTemporalNamespace(Context.current().info.namespace);
  } catch {
    const raw = Bun.env["TEMPORAL_NAMESPACE"];
    return raw === undefined || raw === ""
      ? "prod"
      : parseTemporalNamespace(raw);
  }
}

export async function isReportRemediationEnabled(
  stage: string = resolveCurrentRemediationStage(),
): Promise<boolean> {
  const resolved = await reportRemediationConfig(stage);
  return resolved.value;
}
