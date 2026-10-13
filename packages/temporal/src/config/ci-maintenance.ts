import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";

export async function ciMaintenanceEnabled() {
  return maintenanceFlag("ci-maintenance-dispatch-enabled");
}

export async function ciWorkspaceSeedRefreshEnabled() {
  return maintenanceFlag(
    "ci-workspace-seed-refresh-enabled",
    parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]),
  );
}

async function maintenanceFlag(flag: string, stage = "prod") {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: `ci-maintenance-${stage}`,
        attributes: { environment: stage, stage },
        kinds: { enabled: "boolean" },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn("CI maintenance flag unavailable; dispatch disabled");
      },
    },
  });
  const result = await resolver.get("enabled");
  return result.value;
}
