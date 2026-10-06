import path from "node:path";
import {
  citizens,
  coreProtect,
  luckPerms,
  multiverseCore,
  serverImage,
  stormServerImages,
  worldEdit,
  type PluginPin,
} from "#src/pins.ts";
import type { ProviderKind, SandboxCreateRequest } from "#protocol/ipc.ts";
import { BRIDGE_BUILD_COMMAND, BRIDGE_JAR } from "#protocol/paths.ts";
import { basePaperEnv } from "#sandbox/paper-env.ts";
import {
  STORM_BUILD_COMMAND,
  STORM_DEV_MODULES,
  STORM_PATHS,
  stormImageConfig,
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
      /** Module keys baked into the exact selected image digest. */
      moduleKeys?: readonly string[];
    };

export type ResolvedProfile = {
  image: string;
  env: Record<string, string>;
  /** Pinned third-party jars staged into /plugins. */
  plugins: readonly PluginPin[];
  /** Repository outputs and config staged into /plugins, in order. */
  staged: readonly StagedEntry[];
  /** Mount staged paths individually when the image already owns /plugins. */
  stagedPluginMount?: "tree" | "files";
  /**
   * Seed /data with the pinned Paper jar and a throttle-free bukkit.yml. Off
   * for the published storm image: it bakes its own Paper and config, and its
   * entrypoint refuses a non-empty /data that lacks its progression marker.
   */
  seedData: boolean;
  ports: readonly number[];
  /** Where the profile runs when the request names no provider. */
  defaultProvider: ProviderKind;
  /** Container memory for cluster sandboxes; the JVM heap is env MEMORY. */
  memory: { request: string; limit: string };
};

/** Whether a profile stages anything into /plugins (else the image's own plugins stand). */
export function stagesPlugins(profile: ResolvedProfile): boolean {
  return profile.plugins.length > 0 || profile.staged.length > 0;
}

type Secrets = { bridgeToken: string; rconPassword: string };

const bridgeJar: StagedEntry = {
  kind: "repo-file",
  source: BRIDGE_JAR,
  target: "MCBridge.jar",
  build: BRIDGE_BUILD_COMMAND,
};

function bridgeAndRconEnv(secrets: Secrets): Record<string, string> {
  return {
    ENABLE_RCON: "true",
    RCON_PASSWORD: secrets.rconPassword,
    MC_BRIDGE_TOKEN: secrets.bridgeToken,
    MC_BRIDGE_PORT: BRIDGE_PORT.toString(),
    MC_BRIDGE_BIND: "0.0.0.0",
  };
}

function serverEnv(
  world: SandboxCreateRequest["world"],
  secrets: Secrets,
): Record<string, string> {
  return {
    ...basePaperEnv(),
    ...(world === "void" ? { GENERATOR_SETTINGS: VOID_GENERATOR } : {}),
    ...bridgeAndRconEnv(secrets),
  };
}

const PAPER_MEMORY = { request: "1536Mi", limit: "2Gi" } as const;

/**
 * The `paper` profile: pinned Paper 26.2 with WorldEdit, Citizens (test
 * actors) and MCBridge, offline mode, peaceful, no spawn protection, RCON on.
 * The bridge listens on all interfaces inside the container; Docker publishes
 * it to host loopback only and the cluster reaches it by port-forward.
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
    seedData: true,
    ports: [GAME_PORT, RCON_PORT, BRIDGE_PORT],
    defaultProvider: "docker",
    memory: PAPER_MEMORY,
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
    plugins: [worldEdit, citizens, coreProtect, luckPerms, multiverseCore],
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
        kind: "repo-dir",
        source: STORM_PATHS.ownedCitizensDir,
        target: "Citizens",
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
    seedData: true,
    ports: [GAME_PORT, RCON_PORT, BRIDGE_PORT],
    defaultProvider: "docker",
    memory: { request: "2Gi", limit: "3Gi" },
  };
}

/**
 * The published minecraft-tsmc image booted against a disposable fresh world.
 * The image bakes Paper, every plugin and owned config. Stage a module overlay
 * so the local companion dependencies start while RWF stays off because its
 * production world and recording salt do not exist in this fresh sandbox.
 * MCBridge must be baked into the image (the-storm server Dockerfile); an
 * image without it never answers the bridge health check. Amd64-only, so it
 * defaults to the cluster.
 */
function stormImageProfile(image: string) {
  const imageConfig = stormImageConfig(image);
  return (
    _world: SandboxCreateRequest["world"],
    secrets: Secrets,
  ): ResolvedProfile => ({
    image,
    env: {
      EULA: "TRUE",
      ONLINE_MODE: "FALSE",
      MEMORY: "3G",
      SPAWN_PROTECTION: "0",
      STORM_BRAIN_BEARER_TOKEN: "storm-sandbox-brain-token",
      DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
      DISCORD_CHANNEL_ID: "1",
      // Pseudonymization only in disposable sandboxes; never used in production.
      RWF_RECORDING_SALT: "mc-harness-storm-fixture-recording-salt",
      // Keep companion gameplay suspended while the disposable server boots;
      // the unreachable Flipt endpoint makes rollout evaluation fail closed.
      FLIPT_URL: "http://127.0.0.1:9",
      FLIPT_ENVIRONMENT: "beta",
      ...bridgeAndRconEnv(secrets),
    },
    plugins: [],
    stagedPluginMount: "files",
    staged: [
      {
        kind: "storm-config",
        source: path.join(STORM_PATHS.ownedConfigDir, "config.yml"),
        target: path.join("TheStorm", "config.yml"),
        modules: imageConfig.enabledModules,
        moduleKeys: imageConfig.moduleKeys,
      },
    ],
    seedData: false,
    ports: [GAME_PORT, RCON_PORT, BRIDGE_PORT],
    defaultProvider: "kubernetes",
    memory: { request: "3584Mi", limit: "4608Mi" },
  });
}

const PROFILES: Record<
  SandboxCreateRequest["profile"],
  (world: SandboxCreateRequest["world"], secrets: Secrets) => ResolvedProfile
> = {
  paper: paperProfile,
  "storm-dev": stormDevProfile,
  "storm-prod": stormImageProfile(stormServerImages.prod),
  "storm-candidate": stormImageProfile(stormServerImages.candidate),
};

export function resolveProfile(
  request: Pick<SandboxCreateRequest, "profile" | "world">,
  secrets: Secrets,
): ResolvedProfile {
  return PROFILES[request.profile](request.world, secrets);
}

/** The provider a request runs on: its own choice, else the profile's default. */
export function providerFor(
  request: Pick<SandboxCreateRequest, "profile" | "world" | "provider">,
): ProviderKind {
  return (
    request.provider ??
    resolveProfile(request, {
      bridgeToken: "0".repeat(48),
      rconPassword: "0".repeat(48),
    }).defaultProvider
  );
}
