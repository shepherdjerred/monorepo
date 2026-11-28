import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

/**
 * A maintenance flag as Flags answered it. `unknown` means the Flags source
 * failed, so the code default answered; it is never read as "off" by a
 * monitor, which would resolve an alert during a Flags outage.
 */
export type MaintenanceFlagState = "on" | "off" | "unknown";

export async function ciMaintenanceEnabled() {
  return maintenanceFlag("ci-maintenance-dispatch-enabled");
}

export async function ciMaintenanceDispatchState() {
  return maintenanceFlagState("ci-maintenance-dispatch-enabled");
}

export async function ciWorkspaceSeedRefreshEnabled() {
  return maintenanceFlag("ci-workspace-seed-refresh-enabled");
}

export async function ciWorkspaceGoldenRefreshEnabled() {
  return maintenanceFlag("ci-workspace-golden-refresh-enabled");
}

export async function ciWorkspaceGoldenRefreshState() {
  return maintenanceFlagState("ci-workspace-golden-refresh-enabled");
}

/** Dispatch fails closed: an unavailable Flags source disables maintenance. */
async function maintenanceFlag(flag: string) {
  return (await maintenanceFlagState(flag)) === "on";
}

async function maintenanceFlagState(
  flag: string,
): Promise<MaintenanceFlagState> {
  const source = { failed: false };
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
        source.failed = true;
        console.warn("CI maintenance flag unavailable; dispatch disabled");
      },
    },
  });
  const result = await resolver.get("enabled");
  if (source.failed && result.source !== "flag") return "unknown";
  return result.value ? "on" : "off";
}
