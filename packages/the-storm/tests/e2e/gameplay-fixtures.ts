import path from "node:path";
import { z } from "zod";
import { stormModuleConfig } from "@shepherdjerred/mc-harness/sandbox/storm.ts";
import type { ServerResources, StartServerOptions } from "./harness/server.ts";
import { rwfTestSettings } from "./harness/rwf-settings.ts";

/**
 * Which server a run boots. `e2e` is the focused suite with rwf played by
 * humans only; `full` is every shipped module plus rwf and its bots; `load` is
 * `full` on the production pod's resources with the rwf load test switched on.
 */
export type E2eProfile = "e2e" | "full" | "load";

const ProfileSchema = z.enum(["e2e", "full", "load"]);

/** The profile from STORM_E2E_PROFILE, or STORM_E2E_FULL=1 as the CI lanes set it. */
export function e2eProfile(): E2eProfile {
  const named = Bun.env["STORM_E2E_PROFILE"];
  if (named !== undefined) {
    return ProfileSchema.parse(named);
  }
  return Bun.env["STORM_E2E_FULL"] === "1" ? "full" : "e2e";
}

/**
 * The load profile mirrors the production pod (minecraft-tsmc): a 4-CPU
 * request, an 8G heap and a 10Gi memory limit. The CPU is capped here so the
 * numbers do not depend on the workstation's spare cores;
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
    | "survivalConfig"
  >
> {
  return {
    ...(await profileFixtures(packageRoot, profile)),
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
    case "full": {
      // Every shipped module plus Search and Destroy with its bots, which
      // fill each countdown to the owned targetCombatants (8). The countdown
      // is long enough for the bots to walk in, wander and try kits in the
      // lobby before the match.
      return {
        stormConfig: withBots(owned),
        survivalConfig: survival.replace(/^enabled: false$/mu, "enabled: true"),
        fixturesJar,
        rwf: { ...rwfTestSettings, countdown: "PT25S" },
      };
    }
    case "load": {
      // One human plus up to 100 load-test bots.
      return {
        stormConfig: withBots(owned),
        survivalConfig: survival.replace(/^enabled: false$/mu, "enabled: true"),
        fixturesJar,
        rwf: { ...rwfTestSettings, maxCombatants: 101, loadtest: true },
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
          "tickets",
          "agent",
          "rwf",
        ]),
        fixturesJar,
        rwf: rwfTestSettings,
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
