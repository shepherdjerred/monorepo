import {
  publishPreparedSeed,
  SeedProfileSchema,
  SeedResultSchema,
  SEED_ROOT,
} from "../../packages/woodpecker-config-extension/src/checkout/prepared.ts";
import {
  PLAYWRIGHT_TARGETS,
  additionalPlaywrightInstallFilters,
} from "./selection/playwright-targets.ts";

const [operation, profileArgument, image] = Bun.argv.slice(2);
if (operation === undefined)
  throw new Error("Workspace seed operation is required");
const profile = SeedProfileSchema.parse(profileArgument);
if (image === undefined)
  throw new Error("Workspace seed requires a pinned image");
switch (operation) {
  case "install": {
    const packages = PLAYWRIGHT_TARGETS.map((target) => target.package);
    const filters =
      profile === "verify"
        ? []
        : [
            ...new Set([
              "@shepherdjerred/monorepo",
              "@shepherdjerred/root-scripts",
              "@shepherdjerred/woodpecker-config-extension",
              "scout-for-lol",
              ...packages,
              ...additionalPlaywrightInstallFilters(packages),
            ]),
          ].flatMap((name) => ["--filter", name]);
    const child = Bun.spawn(
      ["ci/scripts/bun-install.sh", "--frozen-lockfile", ...filters],
      { stdout: "inherit", stderr: "inherit" },
    );
    process.exitCode = await child.exited;
    break;
  }
  case "publish": {
    const result = await publishPreparedSeed(
      process.cwd(),
      SEED_ROOT,
      profile,
      { image },
    );
    await Bun.write(
      `/woodpecker/seed-${profile}-result.json`,
      JSON.stringify({ status: result.status }),
    );
    console.log(`CI_WORKSPACE_SEED ${JSON.stringify(result)}`);
    break;
  }
  case "result": {
    const results = await Promise.all(
      ["verify", "browser"].map(async (name) =>
        SeedResultSchema.parse(
          await Bun.file(`/woodpecker/seed-${name}-result.json`).json(),
        ),
      ),
    );
    console.log(
      `CI_MAINTENANCE_RESULT ${JSON.stringify({ status: results.some((result) => result.status === "deferred") ? "deferred" : "completed" })}`,
    );
    break;
  }
  default:
    throw new Error("Unknown workspace seed operation");
}
