import path from "node:path";
import { stormTestConfig, type StartServerOptions } from "./harness/server.ts";
import { rwfTestSettings } from "./harness/rwf-settings.ts";

/** Both local Docker and CI sidecars use the same module and fixture contract. */
export async function gameplayFixtures(
  packageRoot: string,
  full: boolean,
): Promise<
  Pick<
    StartServerOptions,
    | "stormConfig"
    | "fixturesJar"
    | "mechanicsE2eJar"
    | "mechanicsConfig"
    | "companionsE2eJar"
    | "rwf"
  >
> {
  const content = path.join(packageRoot, "server/owned/plugins/TheStorm");
  const owned = await Bun.file(path.join(content, "config.yml")).text();
  // The fixtures plugin builds synthetic worlds and stands for whichever
  // modules the staged config switches on (every one in the full suite; the
  // rwf world alone here) before TheStorm enables.
  const fixturesJar = path.join(
    packageRoot,
    "plugin/dist/build/libs/TheStormFixtures.jar",
  );
  // The focused suite's mechanics plugin owns its listener and geometry;
  // the full suite instead runs the production module with disposable worlds.
  const fixtures = full
    ? { stormConfig: owned, fixturesJar }
    : {
        stormConfig: stormTestConfig(owned, [
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
  return {
    ...fixtures,
    companionsE2eJar: path.join(
      packageRoot,
      "plugin/modules/companions/build/libs/TheStormCompanionsE2E.jar",
    ),
  };
}
