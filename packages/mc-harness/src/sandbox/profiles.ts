import { serverImage, worldEdit, type PluginPin } from "#src/pins.ts";
import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import { basePaperEnv } from "#providers/docker/paper-container.ts";

export const GAME_PORT = 25_565;
export const RCON_PORT = 25_575;
export const BRIDGE_PORT = 25_580;

/** Flat world whose only layer is air: a blank canvas for building. */
const VOID_GENERATOR = JSON.stringify({
  layers: [{ block: "minecraft:air", height: 1 }],
  biome: "minecraft:the_void",
});

export type ResolvedProfile = {
  image: string;
  env: Record<string, string>;
  /** Pinned third-party jars staged into /plugins. */
  plugins: readonly PluginPin[];
  /** Whether the repo-built MCBridge.jar is staged. */
  bridgeJar: true;
  ports: readonly number[];
};

type Secrets = { bridgeToken: string; rconPassword: string };

/**
 * The `paper` profile: pinned Paper 26.2 with WorldEdit and MCBridge, offline
 * mode, peaceful, no spawn protection, RCON on. The bridge listens on all
 * interfaces inside the container; Docker publishes it to host loopback only.
 */
function paperProfile(
  world: SandboxCreateRequest["world"],
  secrets: Secrets,
): ResolvedProfile {
  return {
    image: serverImage,
    env: {
      ...basePaperEnv(),
      ...(world === "void" ? { GENERATOR_SETTINGS: VOID_GENERATOR } : {}),
      ENABLE_RCON: "true",
      RCON_PASSWORD: secrets.rconPassword,
      MC_BRIDGE_TOKEN: secrets.bridgeToken,
      MC_BRIDGE_PORT: BRIDGE_PORT.toString(),
      MC_BRIDGE_BIND: "0.0.0.0",
    },
    plugins: [worldEdit],
    bridgeJar: true,
    ports: [GAME_PORT, RCON_PORT, BRIDGE_PORT],
  };
}

const PROFILES: Record<
  SandboxCreateRequest["profile"],
  (world: SandboxCreateRequest["world"], secrets: Secrets) => ResolvedProfile
> = { paper: paperProfile };

export function resolveProfile(
  request: Pick<SandboxCreateRequest, "profile" | "world">,
  secrets: Secrets,
): ResolvedProfile {
  return PROFILES[request.profile](request.world, secrets);
}
