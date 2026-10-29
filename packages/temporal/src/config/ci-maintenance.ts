import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export async function ciMaintenanceEnabled() {
  return maintenanceFlag("ci-maintenance-dispatch-enabled");
}

export async function ciWorkspaceSeedRefreshEnabled() {
  return maintenanceFlag("ci-workspace-seed-refresh-enabled");
}

export async function ciWorkspaceGoldenRefreshEnabled() {
  return maintenanceFlag("ci-workspace-golden-refresh-enabled");
}

async function maintenanceFlag(flag: string) {
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
        targetingKey: "ci-maintenance-prod",
        attributes: { environment: "prod", stage: "prod" },
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
