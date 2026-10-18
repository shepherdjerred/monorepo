import path from "node:path";
import { z } from "zod";
import imageConfigs from "./storm-image-configs.json";

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
  "safety",
  "companions",
] as const;

/**
 * Config schema snapshots are keyed by the exact published image digest.
 * Production and candidate pins can move independently; never infer an older
 * image's module keys from the current checkout's owned config.
 */
const STORM_IMAGE_CONFIGS = z
  .record(
    z.string().regex(/^[a-f0-9]{64}$/u),
    z
      .object({
        configSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        moduleKeys: z
          .array(z.string().min(1))
          .nonempty()
          .refine((keys) => new Set(keys).size === keys.length),
      })
      .strict(),
  )
  .parse(imageConfigs);

export function stormImageConfig(
  image: string,
  frozenConfig?: { yaml: string; sha256: string },
): {
  moduleKeys: readonly string[];
  enabledModules: readonly string[];
} {
  const digest = /@sha256:([a-f0-9]{64})$/u.exec(image)?.[1];
  if (digest === undefined) {
    throw new Error(`Storm sandbox image must be digest-pinned: ${image}`);
  }
  const config =
    frozenConfig === undefined
      ? STORM_IMAGE_CONFIGS[digest]
      : {
          configSha256: frozenConfig.sha256,
          moduleKeys: Object.keys(
            z
              .object({ modules: z.record(z.string().min(1), z.boolean()) })
              .strict()
              .parse(Bun.YAML.parse(frozenConfig.yaml)).modules,
          ),
        };
  if (
    frozenConfig !== undefined &&
    new Bun.CryptoHasher("sha256").update(frozenConfig.yaml).digest("hex") !==
      frozenConfig.sha256
  )
    throw new Error("Frozen Storm image configuration digest differs");
  if (config === undefined) {
    throw new Error(
      `No Storm module config snapshot for image digest ${digest}`,
    );
  }
  const missing = STORM_IMAGE_ENABLED_MODULES.filter(
    (module) => !config.moduleKeys.includes(module),
  );
  if (missing.length > 0)
    throw new Error(
      `Storm image lacks required sandbox modules: ${missing.join(", ")}`,
    );
  return {
    moduleKeys: config.moduleKeys,
    enabledModules: STORM_IMAGE_ENABLED_MODULES,
  };
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
