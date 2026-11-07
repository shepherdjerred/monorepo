import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import type { WoodpeckerBooleanFlagKey } from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import { z } from "zod";

const booleanFlag = (flag: WoodpeckerBooleanFlagKey) => ({
  schema: z.boolean(),
  sources: ["flag", "default"] as const,
  default: managedBooleanDefault(flag),
  names: { flag },
});
export const DISABLED_PERFORMANCE = {
  incremental: false,
  prepared: false,
  formatting: false,
  gradle: false,
  grouping: false,
  copyfile: false,
  scratch: false,
};
export type PerformanceOptions = typeof DISABLED_PERFORMANCE;

export async function performanceConfig(
  branch: string,
): Promise<PerformanceOptions> {
  const resolver = defineConfig({
    definition: {
      incremental: booleanFlag("woodpecker-source-incremental-enabled"),
      prepared: booleanFlag("woodpecker-prepared-workspace-enabled"),
      formatting: booleanFlag("woodpecker-format-cache-enabled"),
      gradle: booleanFlag("woodpecker-gradle-seed-enabled"),
      grouping: booleanFlag("woodpecker-small-check-grouping-enabled"),
      copyfile: booleanFlag("woodpecker-bun-copyfile-enabled"),
      scratch: booleanFlag("woodpecker-ram-scratch-enabled"),
    },
    sources: {
      flag: createFlagConfigSource({
        targetingKey: branch,
        attributes: {
          stage: branch.startsWith("ci-canary/") ? "beta" : "prod",
        },
        kinds: {
          incremental: "boolean",
          prepared: "boolean",
          formatting: "boolean",
          gradle: "boolean",
          grouping: "boolean",
          copyfile: "boolean",
          scratch: "boolean",
        },
        requireFreshSnapshot: true,
      }),
    },
    hooks: {
      onSourceError: () => {
        console.warn(
          "CI performance flag unavailable; using declared defaults",
        );
      },
    },
  });
  const [
    incremental,
    prepared,
    formatting,
    gradle,
    grouping,
    copyfile,
    scratch,
  ] = await Promise.all([
    resolver.get("incremental"),
    resolver.get("prepared"),
    resolver.get("formatting"),
    resolver.get("gradle"),
    resolver.get("grouping"),
    resolver.get("copyfile"),
    resolver.get("scratch"),
  ]);
  return {
    incremental: incremental.value,
    prepared: prepared.value,
    formatting: formatting.value,
    gradle: gradle.value,
    grouping: grouping.value,
    copyfile: copyfile.value,
    scratch: scratch.value,
  };
}
