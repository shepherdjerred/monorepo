import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import { createFileSource } from "@shepherdjerred/config/sources/file.ts";
import { BRIDGE_LIMITS } from "#protocol/bridge.ts";
import { DEFAULT_KUBE_CONTEXT } from "#providers/kubernetes/kubectl.ts";
import type { LiveGuardConfig } from "#src/live/guard.ts";

const BooleanSettingSchema = z.union([z.boolean(), z.stringbool()]);
const WorldListSchema = z.union([
  z.array(z.string().min(1)).min(1),
  z
    .string()
    .min(1)
    .transform((raw) =>
      raw
        .split(",")
        .map((world) => world.trim())
        .filter((world) => world.length > 0),
    ),
]);

/**
 * Daemon settings, layered `env -> ~/.toolkit/config.toml -> default` like the
 * toolkit's own config (the daemon runs from a workstation checkout).
 */
export const MC_DAEMON_CONFIG_DEFINITION = {
  /**
   * kubeconfig context for cluster sandboxes and live tsmc. Explicit so a
   * kubectl `current-context` switch never redirects the harness.
   */
  mcKubeContext: {
    schema: z.string().min(1),
    sources: ["env", "file", "default"],
    default: DEFAULT_KUBE_CONTEXT,
  },
  /** Kill switch for every write to live minecraft-tsmc. */
  mcLiveWrites: {
    schema: BooleanSettingSchema,
    sources: ["env", "file", "default"],
    default: true,
  },
  /** Worlds live block writes may touch; never the quarterly-reset `mining`. */
  mcLiveWorlds: {
    schema: WorldListSchema,
    sources: ["env", "file", "default"],
    default: ["world", "wilds", "peaks"],
  },
  /** Live block writes larger than this need a recent Velero backup. */
  mcLiveMaxRegionVolume: {
    schema: z.coerce.number().int().positive(),
    sources: ["env", "file", "default"],
    default: 1_000_000,
  },
  /** How old (hours) the newest Velero backup may be for a tier-2 live write. */
  mcLiveBackupMaxAgeHours: {
    schema: z.coerce.number().positive(),
    sources: ["env", "file", "default"],
    default: 24,
  },
  /** Humans this close (blocks) to a live write's box need --allow-players. */
  mcLiveNearPlayerRadius: {
    schema: z.coerce.number().int().min(0),
    sources: ["env", "file", "default"],
    default: 32,
  },
} as const;

export async function loadMcDaemonConfig() {
  return defineConfig({
    definition: MC_DAEMON_CONFIG_DEFINITION,
    sources: {
      env: createEnvSource(Bun.env),
      file: await createFileSource({
        path: path.join(os.homedir(), ".toolkit/config.toml"),
      }),
    },
  });
}

type McDaemonConfig = Awaited<ReturnType<typeof loadMcDaemonConfig>>;

/** The live write guard settings, read per write so config edits apply without a restart. */
export async function liveGuardConfig(
  config: McDaemonConfig,
): Promise<LiveGuardConfig> {
  const worlds = await config.value("mcLiveWorlds");
  if (worlds.includes("mining")) {
    throw new Error(
      "mcLiveWorlds must not include mining (it is wiped every quarter)",
    );
  }
  return {
    writes: await config.value("mcLiveWrites"),
    worlds,
    maxRegionVolume: await config.value("mcLiveMaxRegionVolume"),
    backupMaxAgeHours: await config.value("mcLiveBackupMaxAgeHours"),
    nearPlayerRadius: await config.value("mcLiveNearPlayerRadius"),
    maxSnapshotVolume: BRIDGE_LIMITS.maxSnapshotVolume,
  };
}
