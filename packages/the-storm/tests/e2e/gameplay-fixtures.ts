import path from "node:path";
import { stormTestConfig, type StartServerOptions } from "./harness/server.ts";

/** Both local Docker and CI sidecars use the same module and fixture contract. */
export async function gameplayFixtures(
  packageRoot: string,
  full: boolean,
): Promise<
  Pick<
    StartServerOptions,
    "stormConfig" | "fixturesJar" | "mechanicsE2eJar" | "mechanicsConfig"
  >
> {
  const content = path.join(packageRoot, "server/owned/plugins/TheStorm");
  const owned = await Bun.file(path.join(content, "config.yml")).text();
  // The focused suite's mechanics plugin owns its listener and geometry;
  // the full suite instead runs the production module with disposable worlds.
  return full
    ? {
        stormConfig: owned,
        fixturesJar: path.join(
          packageRoot,
          "plugin/dist/build/libs/TheStormFixtures.jar",
        ),
      }
    : {
        stormConfig: stormTestConfig(owned, [
          "economy",
          "mail",
          "chat",
          "tracks",
          "towns",
          "tickets",
          "agent",
        ]),
        mechanicsE2eJar: path.join(
          packageRoot,
          "plugin/modules/mechanics/build/libs/TheStormMechanicsE2E.jar",
        ),
        mechanicsConfig: await Bun.file(
          path.join(content, "mechanics.yml"),
        ).text(),
      };
}
