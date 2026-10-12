import path from "node:path";
import { z } from "zod";
import { stormModuleConfig } from "@shepherdjerred/mc-harness/sandbox/storm.ts";
import type { ServerResources, StartServerOptions } from "./harness/server.ts";
import {
  fullRwfTestSettings,
  rwfTestSettings,
  suiteMaps,
} from "./harness/rwf-settings.ts";

/**
 * Which server a run boots. `e2e` is the focused suite with rwf played by
 * humans only; `full` enables every shipped module plus rwf and its bots.
 * `load` retains the historical four-CPU test shape; `capacity` uses a
 * measured CPU cap and imported maps to judge the requested higher match limits.
 */
export type E2eProfile = "e2e" | "full" | "load" | "capacity";

const ProfileSchema = z.enum(["e2e", "full", "load", "capacity"]);

export function capacityMap(): string {
  return z
    .enum(["apex-expanse", "warlords-castles"])
    .parse(Bun.env["STORM_CAPACITY_MAP"]);
}

export function capacityResources(): ServerResources & { cpus: number } {
  return {
    cpus: z.coerce
      .number()
      .pipe(z.union([z.literal(3), z.literal(4), z.literal(6)]))
      .parse(Bun.env["STORM_CAPACITY_CPUS"] ?? 3),
    heap: "8G",
    memoryLimit: "10g",
  };
}

/** The profile from STORM_E2E_PROFILE, or STORM_E2E_FULL=1 as the CI lanes set it. */
export function e2eProfile(): E2eProfile {
  const named = Bun.env["STORM_E2E_PROFILE"];
  if (named !== undefined) {
    return ProfileSchema.parse(named);
  }
  return Bun.env["STORM_E2E_FULL"] === "1" ? "full" : "e2e";
}

/**
 * The load profile retains its historical 4-CPU cap, 8G heap and 10Gi memory
 * limit. The CPU is capped so numbers do not depend on the workstation's spare cores;
 * `STORM_E2E_LOAD_CPUS` measures another cap (6 to size the pod).
 */
export function loadResources(): ServerResources {
  const cpus = Bun.env["STORM_E2E_LOAD_CPUS"];
  return {
    cpus:
      cpus === undefined
        ? 4
        : z.coerce.number().int().min(1).max(16).parse(cpus),
    heap: "8G",
    memoryLimit: "10g",
  };
}

const OwnedModulesSchema = z
  .object({ modules: z.record(z.string(), z.boolean()) })
  .strict();

/** The shipped config with rwf and rwfbots switched on as well. */
function withBots(owned: string): string {
  const enabled = Object.entries(
    OwnedModulesSchema.parse(Bun.YAML.parse(owned)).modules,
  )
    .filter(([, on]) => on)
    .map(([module]) => module);
  return stormModuleConfig(owned, [...enabled, "rwf", "rwfbots"]);
}

/** Local Docker and CI sidecars use the same module and fixture contract per profile. */
export async function gameplayFixtures(
  packageRoot: string,
  profile: E2eProfile,
): Promise<
  Pick<
    StartServerOptions,
    | "stormConfig"
    | "fixturesJar"
    | "mechanicsE2eJar"
    | "mechanicsConfig"
    | "companionsE2eJar"
    | "rwf"
    | "rwfMap"
    | "rwfbotsConfig"
    | "survivalConfig"
  >
> {
  return {
    ...(await profileFixtures(packageRoot, profile)),
    // These suites assert authored Training Yard coordinates, bombs and spawn capacity.
    rwfMap: profile === "capacity" ? capacityMap() : "training-yard",
    ...(profile === "capacity"
      ? { rwfbotsConfig: await capacityBotsConfig(packageRoot) }
      : {}),
    companionsE2eJar: path.join(
      packageRoot,
      "plugin/modules/companions/build/libs/TheStormCompanionsE2E.jar",
    ),
  };
}

async function profileFixtures(
  packageRoot: string,
  profile: E2eProfile,
): Promise<
  Pick<
    StartServerOptions,
    | "stormConfig"
    | "fixturesJar"
    | "mechanicsE2eJar"
    | "mechanicsConfig"
    | "rwf"
    | "survivalConfig"
  >
> {
  const content = path.join(packageRoot, "server/owned/plugins/TheStorm");
  const owned = await Bun.file(path.join(content, "config.yml")).text();
  const survival = await Bun.file(
    path.join(content, "arena/survival.yml"),
  ).text();
  // The fixtures plugin builds synthetic worlds and stands for whichever
  // modules the staged config switches on (every one in the full suite; the
  // rwf world alone here) before TheStorm enables.
  const fixturesJar = path.join(
    packageRoot,
    "plugin/dist/build/libs/TheStormFixtures.jar",
  );
  switch (profile) {
    case "capacity": {
      return {
        stormConfig: withBots(owned),
        survivalConfig: survival.replace(/^enabled: false$/mu, "enabled: true"),
        fixturesJar,
        rwf: { ...fullRwfTestSettings, countdown: "PT60S", maxCombatants: 256 },
      };
    }
    case "full": {
      // Every shipped module plus Search and Destroy with its bots, which
      // fill each countdown to the owned targetCombatants (8). The countdown
      // is long enough for the bots to walk in, wander and try kits in the
      // lobby before the match.
      return {
        stormConfig: withBots(owned),
        survivalConfig: survival.replace(/^enabled: false$/mu, "enabled: true"),
        fixturesJar,
        rwf: { ...fullRwfTestSettings, maps: suiteMaps },
      };
    }
    case "load": {
      // One human plus up to 100 load-test bots.
      return {
        stormConfig: withBots(owned),
        survivalConfig: survival.replace(/^enabled: false$/mu, "enabled: true"),
        fixturesJar,
        rwf: {
          ...rwfTestSettings,
          maxCombatants: 101,
          loadtest: true,
          maps: suiteMaps,
        },
      };
    }
    case "e2e": {
      // The focused suite's mechanics plugin owns its listener and
      // geometry; the full suite instead runs the production module with
      // disposable worlds.
      return {
        stormConfig: stormModuleConfig(owned, [
          "economy",
          "mail",
          "chat",
          "tracks",
          "towns",
          "essentials",
          "tickets",
          "agent",
          "rwf",
        ]),
        fixturesJar,
        rwf: { ...rwfTestSettings, maps: suiteMaps },
        mechanicsE2eJar: path.join(
          packageRoot,
          "plugin/modules/mechanics/build/libs/TheStormMechanicsE2E.jar",
        ),
        mechanicsConfig: await Bun.file(
          path.join(content, "mechanics.yml"),
        ).text(),
      };
    }
  }
}

async function capacityBotsConfig(packageRoot: string): Promise<string> {
  const owned = await Bun.file(
    path.join(packageRoot, "server/owned/plugins/TheStorm/rwfbots.yml"),
  ).text();
  const raw = Bun.env["STORM_CAPACITY_RAY_BUDGET"];
  if (raw === undefined) return owned;
  const budget = z.coerce.number().int().positive().parse(raw);
  const overlaid = owned.replace(
    /^ {2}losRayBudgetPerThink: \d+$/mu,
    `  losRayBudgetPerThink: ${budget.toString()}`,
  );
  if (
    overlaid === owned &&
    !owned.includes(`  losRayBudgetPerThink: ${budget.toString()}`)
  ) {
    throw new Error("The capacity fixture could not find the LOS budget");
  }
  return overlaid;
}
