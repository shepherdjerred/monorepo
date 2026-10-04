import path from "node:path";
import {
  citizens,
  luckPerms,
  multiverseCore,
  serverImage,
  worldEdit,
  type PluginPin,
} from "#src/pins.ts";
import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import { BRIDGE_BUILD_COMMAND, BRIDGE_JAR } from "#protocol/paths.ts";
import { basePaperEnv } from "#providers/docker/paper-container.ts";
import {
  STORM_BUILD_COMMAND,
  STORM_DEV_MODULES,
  STORM_PATHS,
} from "#sandbox/storm.ts";

export const GAME_PORT = 25_565;
export const RCON_PORT = 25_575;
export const BRIDGE_PORT = 25_580;

/** Flat world whose only layer is air: a blank canvas for building. */
const VOID_GENERATOR = JSON.stringify({
  layers: [{ block: "minecraft:air", height: 1 }],
  biome: "minecraft:the_void",
});

/**
 * One thing copied into the sandbox's /plugins mount from this repository.
 * `target` is relative to /plugins. Missing build outputs fail with `build`.
 */
export type StagedEntry =
  | { kind: "repo-file"; source: string; target: string; build?: string }
  | { kind: "repo-dir"; source: string; target: string }
  | {
      kind: "storm-config";
      /** The repository-owned config.yml whose module keys are kept. */
      source: string;
      target: string;
      modules: readonly string[];
    };

export type ResolvedProfile = {
  image: string;
  env: Record<string, string>;
  /** Pinned third-party jars staged into /plugins. */
  plugins: readonly PluginPin[];
  /** Repository outputs and config staged into /plugins, in order. */
  staged: readonly StagedEntry[];
  ports: readonly number[];
};

type Secrets = { bridgeToken: string; rconPassword: string };

const bridgeJar: StagedEntry = {
  kind: "repo-file",
  source: BRIDGE_JAR,
  target: "MCBridge.jar",
  build: BRIDGE_BUILD_COMMAND,
};

function serverEnv(
  world: SandboxCreateRequest["world"],
  secrets: Secrets,
): Record<string, string> {
  return {
    ...basePaperEnv(),
    ...(world === "void" ? { GENERATOR_SETTINGS: VOID_GENERATOR } : {}),
    ENABLE_RCON: "true",
    RCON_PASSWORD: secrets.rconPassword,
    MC_BRIDGE_TOKEN: secrets.bridgeToken,
    MC_BRIDGE_PORT: BRIDGE_PORT.toString(),
    MC_BRIDGE_BIND: "0.0.0.0",
  };
}

/**
 * The `paper` profile: pinned Paper 26.2 with WorldEdit, Citizens (test
 * actors) and MCBridge, offline mode, peaceful, no spawn protection, RCON on.
 * The bridge listens on all interfaces inside the container; Docker publishes
 * it to host loopback only.
 */
function paperProfile(
  world: SandboxCreateRequest["world"],
  secrets: Secrets,
): ResolvedProfile {
  return {
    image: serverImage,
    env: serverEnv(world, secrets),
    plugins: [worldEdit, citizens],
    staged: [bridgeJar],
    ports: [GAME_PORT, RCON_PORT, BRIDGE_PORT],
  };
}

/**
 * The `storm-dev` profile: the `paper` profile plus the locally built
 * TheStorm.jar with its required plugins and repository-owned config, the
 * modules in STORM_DEV_MODULES, and the mechanics E2E plugin (the production
 * mechanics module plus its bridge and super-push fixtures at x 400-415).
 * Mirrors the-storm's six-module E2E suite without the storm-brain agent.
 */
function stormDevProfile(
  world: SandboxCreateRequest["world"],
  secrets: Secrets,
): ResolvedProfile {
  return {
    image: serverImage,
    env: serverEnv(world, secrets),
    plugins: [worldEdit, citizens, luckPerms, multiverseCore],
    staged: [
      bridgeJar,
      {
        kind: "repo-file",
        source: STORM_PATHS.jar,
        target: "TheStorm.jar",
        build: STORM_BUILD_COMMAND,
      },
      {
        kind: "repo-dir",
        source: STORM_PATHS.ownedConfigDir,
        target: "TheStorm",
      },
      {
        kind: "storm-config",
        source: path.join(STORM_PATHS.ownedConfigDir, "config.yml"),
        target: path.join("TheStorm", "config.yml"),
        modules: STORM_DEV_MODULES,
      },
      {
        kind: "repo-file",
        source: STORM_PATHS.mechanicsE2eJar,
        target: "TheStormMechanicsE2E.jar",
        build: STORM_BUILD_COMMAND,
      },
      {
        kind: "repo-file",
        source: path.join(STORM_PATHS.ownedConfigDir, "mechanics.yml"),
        target: path.join("TheStormMechanicsE2E", "mechanics.yml"),
      },
    ],
    ports: [GAME_PORT, RCON_PORT, BRIDGE_PORT],
  };
}

const PROFILES: Record<
  SandboxCreateRequest["profile"],
  (world: SandboxCreateRequest["world"], secrets: Secrets) => ResolvedProfile
> = { paper: paperProfile, "storm-dev": stormDevProfile };

export function resolveProfile(
  request: Pick<SandboxCreateRequest, "profile" | "world">,
  secrets: Secrets,
): ResolvedProfile {
  return PROFILES[request.profile](request.world, secrets);
}
