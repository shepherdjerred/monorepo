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
} as const;

/**
 * Modules `storm-dev` switches on: playable gameplay without external
 * services. `agent` needs storm-brain, `discord` a bot token and `world`
 * Flipt, so they stay off. Mechanics runs inside TheStormMechanicsE2E, which
 * also prepares its fixture geometry.
 */
export const STORM_DEV_MODULES = [
  "economy",
  "chat",
  "tracks",
  "towns",
  "tickets",
] as const;

const OwnedStormConfigSchema = z
  .object({ modules: z.record(z.string(), z.boolean()) })
  .strict();

/**
 * Turns the repository-owned config.yml into one with only `enabled` modules
 * switched on. The plugin rejects a config that omits a module, so the key set
 * always follows the owned file.
 */
export function stormModuleConfig(
  ownedYaml: string,
  enabled: readonly string[],
): string {
  const owned = OwnedStormConfigSchema.parse(Bun.YAML.parse(ownedYaml));
  const known = new Set(Object.keys(owned.modules));
  const unknown = enabled.filter((module) => !known.has(module));
  if (unknown.length > 0) {
    throw new Error(`Unknown modules: ${unknown.join(", ")}`);
  }
  const on = new Set(enabled);
  const modules = Object.keys(owned.modules).map(
    (module) => `  ${module}: ${on.has(module).toString()}`,
  );
  return ["modules:", ...modules, ""].join("\n");
}
