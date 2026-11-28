import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  CARGO_CI_DEBUGINFO_ENVIRONMENT,
  SCCACHE_WEBDAV_ENVIRONMENT,
  withoutSccacheWebdav,
} from "#src/pipeline/sccache-webdav.ts";
import { testPipelineSteps } from "#test-identity";

const REPOSITORY = new URL("../../../../", import.meta.url).pathname;
const PROFILE_VARIABLES = Object.keys(CARGO_CI_DEBUGINFO_ENVIRONMENT).filter(
  (name) => name.startsWith("CARGO_PROFILE_"),
);
/** The verify tasks that can run cargo. */
const CARGO_TASKS = [
  "build",
  "build:local",
  "typecheck",
  "lint",
  "test",
  "test:local",
  "test:ci",
];

test("verify builds workspace crates with limited debuginfo and dependencies with none", () => {
  expect(CARGO_CI_DEBUGINFO_ENVIRONMENT).toEqual({
    CARGO_PROFILE_DEV_DEBUG: "limited",
    CARGO_PROFILE_TEST_DEBUG: "limited",
    CI_CARGO_DEPENDENCY_DEBUG: "none",
  });
  expect(SCCACHE_WEBDAV_ENVIRONMENT).toMatchObject(
    CARGO_CI_DEBUGINFO_ENVIRONMENT,
  );
  const verify = testPipelineSteps().find((step) => step.key === "verify");
  expect(verify?.environment).toMatchObject(CARGO_CI_DEBUGINFO_ENVIRONMENT);
  // Only dev and test: release builds keep their own `debug` settings.
  expect(
    Object.keys(verify?.environment ?? {}).filter((name) =>
      name.startsWith("CARGO_PROFILE_"),
    ),
  ).toEqual(PROFILE_VARIABLES);
});

const TurboConfig = z.object({
  globalPassThroughEnv: z.array(z.string()).optional(),
  tasks: z
    .record(
      z.string(),
      z.object({ passThroughEnv: z.array(z.string()).optional() }),
    )
    .optional(),
});
const PackageManifest = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
});

/** Parse a `turbo.json`, which allows whole-line `//` comments. */
async function readTurboConfig(file: string) {
  const text = await Bun.file(file).text();
  return TurboConfig.parse(
    JSON.parse(
      text
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n"),
    ),
  );
}

/** Directories of Cargo workspaces owned by a package. */
async function cargoPackageDirectories(): Promise<string[]> {
  const found: string[] = [];
  for (const pattern of [
    "packages/*/Cargo.toml",
    "packages/scout-for-lol/packages/*/Cargo.toml",
  ])
    for await (const file of new Bun.Glob(pattern).scan({ cwd: REPOSITORY }))
      found.push(path.join(REPOSITORY, path.dirname(file)));
  return found;
}

test("Turbo passes the CARGO_PROFILE variables to every task that runs cargo, per package", async () => {
  const directories = await cargoPackageDirectories();
  expect(directories.map((d) => d.slice(REPOSITORY.length))).toEqual(
    expect.arrayContaining([
      "packages/charts",
      "packages/ci-cache",
      "packages/glitter-boys-launcher",
      "packages/scout-for-lol/packages/desktop",
    ]),
  );
  for (const directory of directories) {
    const manifest = PackageManifest.parse(
      await Bun.file(path.join(directory, "package.json")).json(),
    );
    const ciTests = Bun.file(path.join(directory, "ci-tests.json"));
    const ciTestsText = (await ciTests.exists()) && (await ciTests.text());
    const cargoCi = ciTestsText !== false && ciTestsText.includes('"cargo"');
    const tasks = CARGO_TASKS.filter(
      (task) =>
        manifest.scripts?.[task]?.includes("cargo") === true ||
        (task === "test:ci" && cargoCi),
    );
    if (tasks.length === 0) continue; // a crate verify never builds
    const config = await readTurboConfig(path.join(directory, "turbo.json"));
    for (const task of tasks)
      for (const name of PROFILE_VARIABLES)
        expect(
          config.tasks?.[task]?.passThroughEnv,
          `${directory} ${task}`,
        ).toContain(name);
  }
});

test("root turbo.json stays free of CI Rust settings, because it is a global verification input", async () => {
  const file = path.join(REPOSITORY, "turbo.json");
  const root = await readTurboConfig(file);
  const text = await Bun.file(file).text();
  for (const name of Object.keys(CARGO_CI_DEBUGINFO_ENVIRONMENT)) {
    expect(root.globalPassThroughEnv ?? [], name).not.toContain(name);
    expect(text, name).not.toContain(name);
  }
});

test("disabling remote sccache keeps the debuginfo settings and drops the cache", () => {
  const environment = withoutSccacheWebdav({
    ...SCCACHE_WEBDAV_ENVIRONMENT,
    CI_CHANGED_BASE: "",
  });
  expect(environment).toEqual({
    ...CARGO_CI_DEBUGINFO_ENVIRONMENT,
    CI_CHANGED_BASE: "",
  });
});
