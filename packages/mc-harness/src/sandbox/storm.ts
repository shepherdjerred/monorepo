import path from "node:path";
import { z } from "zod";

// The Storm's repository layout, as the `storm-dev` profile stages it. These
// are paths in this monorepo, not a package dependency: mc-harness never
// imports the-storm.
const STORM = path.join("packages", "the-storm");

export const STORM_BUILD_COMMAND =
  "bunx turbo run build --filter=@shepherdjerred/the-storm";

export const STORM_PATHS = {
  jar: path.join(STORM, "plugin", "dist", "build", "libs", "TheStorm.jar"),
  fixturesJar: path.join(
    STORM,
    "plugin",
    "dist",
    "build",
    "libs",
    "TheStormFixtures.jar",
  ),
  mechanicsE2eJar: path.join(
    STORM,
    "plugin",
    "modules",
    "mechanics",
    "build",
    "libs",
    "TheStormMechanicsE2E.jar",
  ),
  ownedConfigDir: path.join(STORM, "server", "owned", "plugins", "TheStorm"),
  /** Keeps Citizens NPCs (story NPCs, companions, bots) off the tab list. */
  ownedCitizensDir: path.join(STORM, "server", "owned", "plugins", "Citizens"),
} as const;

/**
 * Modules `storm-dev` switches on: playable gameplay without external
 * services. `agent` needs storm-brain, `discord` a bot token and `world`
 * Flipt, so they stay off. Towns requires the mail service. Mechanics runs
 * inside TheStormMechanicsE2E, which also prepares its fixture geometry.
 */
export const STORM_DEV_MODULES = [
  "economy",
  "mail",
  "chat",
  "tracks",
  "towns",
  "tickets",
] as const;

/**
 * Modules enabled in published-image sandboxes. Companions' local gameplay
 * dependencies are present; RWF stays off because disposable servers do not
 * carry the provisioned `rwf` world or production recording salt.
 */
const STORM_IMAGE_ENABLED_MODULES = [
  ...STORM_DEV_MODULES,
  "companions",
] as const;

const STORM_IMAGE_MODULE_KEYS = [
  "economy",
  "messages",
  "mail",
  "chat",
  "discord",
  "essentials",
  "shops",
  "shards",
  "towns",
  "tracks",
  "mechanics",
  "spells",
  "npcs",
  "quests",
  "arena",
  "mobs",
  "qol",
  "skills",
  "seasonal",
  "world",
  "tickets",
  "agent",
  "companions",
  "rwf",
  "rwfbots",
] as const;

/**
 * Config schema snapshots are keyed by the exact published image digest.
 * Production and candidate pins can move independently; never infer an older
 * image's module keys from the current checkout's owned config.
 */
const STORM_IMAGE_CONFIGS: Readonly<
  Record<
    string,
    { moduleKeys: readonly string[]; enabledModules: readonly string[] }
  >
> = {
  a9158e5c64baa0be50a8d56e1e20b168a61e5d1d6f12763e70b6b74f7ba9d7b1: {
    moduleKeys: STORM_IMAGE_MODULE_KEYS,
    enabledModules: STORM_IMAGE_ENABLED_MODULES,
  },
  // Pipeline 6485's exact published /plugins/TheStorm/config.yml has these keys.
  ecc53031a712ad66acd4cd0108ac6afcae706afc382c8618e79e338aa0430201: {
    moduleKeys: STORM_IMAGE_MODULE_KEYS,
    enabledModules: STORM_IMAGE_ENABLED_MODULES,
  },
  // Pipeline 6602's exact published /plugins/TheStorm/config.yml has these keys.
  "6ed63721f4ad14c7d29a389eacd2685016941caf1515f7d9b67dbbc010511144": {
    moduleKeys: STORM_IMAGE_MODULE_KEYS,
    enabledModules: STORM_IMAGE_ENABLED_MODULES,
  },
  // Read /plugins/TheStorm/config.yml from this exact digest before retaining its pin.
  "8d71ceb5287d1230d6be361eb25ea4f8613d66607486a0287f9c664d9f3006f4": {
    moduleKeys: STORM_IMAGE_MODULE_KEYS,
    enabledModules: STORM_IMAGE_ENABLED_MODULES,
  },
};

export function stormImageConfig(image: string): {
  moduleKeys: readonly string[];
  enabledModules: readonly string[];
} {
  const digest = /@sha256:([a-f0-9]{64})$/u.exec(image)?.[1];
  if (digest === undefined) {
    throw new Error(`Storm sandbox image must be digest-pinned: ${image}`);
  }
  const config = STORM_IMAGE_CONFIGS[digest];
  if (config === undefined) {
    throw new Error(
      `No Storm module config snapshot for image digest ${digest}`,
    );
  }
  return config;
}

const OwnedStormConfigSchema = z
  .object({ modules: z.record(z.string(), z.boolean()) })
  .strict();

/**
 * Turns the repository-owned config.yml into one with only `enabled` modules
 * switched on. Published images use their digest-pinned module key snapshot;
 * local dev follows the repository-owned file.
 */
export function stormModuleConfig(
  ownedYaml: string,
  enabled: readonly string[],
  imageModuleKeys?: readonly string[],
): string {
  const owned = OwnedStormConfigSchema.parse(Bun.YAML.parse(ownedYaml));
  const moduleKeys = imageModuleKeys ?? Object.keys(owned.modules);
  const known = new Set(moduleKeys);
  if (known.size !== moduleKeys.length) {
    throw new Error("Storm module config snapshot contains duplicate keys");
  }
  const unknown = enabled.filter((module) => !known.has(module));
  if (unknown.length > 0) {
    throw new Error(`Unknown modules: ${unknown.join(", ")}`);
  }
  const on = new Set(enabled);
  const modules = moduleKeys.map(
    (module) => `  ${module}: ${on.has(module).toString()}`,
  );
  return ["modules:", ...modules, ""].join("\n");
}
