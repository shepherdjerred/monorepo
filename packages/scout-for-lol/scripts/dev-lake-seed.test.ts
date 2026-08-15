import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  adoptSeedIfUnseeded,
  copySeedInto,
  publishedBuildId,
  seedLakeDir,
} from "./dev-lake-seed.ts";

let workspace = "";
const originalDataHome = Bun.env["XDG_DATA_HOME"];

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "scout-seed-"));
  // Point the shared seed at a throwaway directory so a test run can never
  // read — or overwrite — the developer's real seed.
  Bun.env["XDG_DATA_HOME"] = path.join(workspace, "data");
});

afterEach(async () => {
  if (originalDataHome === undefined) {
    delete Bun.env["XDG_DATA_HOME"];
  } else {
    Bun.env["XDG_DATA_HOME"] = originalDataHome;
  }
  await rm(workspace, { recursive: true, force: true });
});

/** A lake with one published build, plus the staging dirs startup creates. */
async function writeLake(lakeDir: string, buildId: string): Promise<void> {
  await mkdir(path.join(lakeDir, "builds", buildId, "matches"), {
    recursive: true,
  });
  await mkdir(path.join(lakeDir, "matches-recent"), { recursive: true });
  await writeFile(
    path.join(lakeDir, "builds", buildId, "matches", "data_0.parquet"),
    "rows",
  );
  await writeFile(path.join(lakeDir, "CURRENT"), `${buildId}\n`);
}

test("an empty lake directory is not a published build", async () => {
  const lake = path.join(workspace, "lake");
  await mkdir(path.join(lake, "matches-recent"), { recursive: true });
  expect(await publishedBuildId(lake)).toBeNull();
});

test("a CURRENT naming a missing build is not a published build", async () => {
  const lake = path.join(workspace, "lake");
  await mkdir(path.join(lake, "builds"), { recursive: true });
  await writeFile(path.join(lake, "CURRENT"), "1786-0001\n");
  expect(await publishedBuildId(lake)).toBeNull();
});

test("reads the build id CURRENT points at", async () => {
  const lake = path.join(workspace, "lake");
  await writeLake(lake, "1786686600822-0001");
  expect(await publishedBuildId(lake)).toBe("1786686600822-0001");
});

test("copies the seed into an unseeded checkout", async () => {
  await writeLake(seedLakeDir(), "1786686600822-0001");
  const lake = path.join(workspace, "checkout", "report-lake");
  await mkdir(path.join(lake, "matches-recent"), { recursive: true });

  const message = await adoptSeedIfUnseeded(lake);

  expect(message).toContain("1786686600822-0001");
  expect(await publishedBuildId(lake)).toBe("1786686600822-0001");
  expect(
    await Bun.file(
      path.join(
        lake,
        "builds",
        "1786686600822-0001",
        "matches",
        "data_0.parquet",
      ),
    ).text(),
  ).toBe("rows");
});

test("leaves a checkout that already has a build alone", async () => {
  await writeLake(seedLakeDir(), "seed-0001");
  const lake = path.join(workspace, "checkout", "report-lake");
  await writeLake(lake, "local-0001");

  const message = await adoptSeedIfUnseeded(lake);

  expect(message).toContain("local-0001");
  expect(await publishedBuildId(lake)).toBe("local-0001");
});

test("says how to build a seed when there is none", async () => {
  const lake = path.join(workspace, "checkout", "report-lake");
  await mkdir(lake, { recursive: true });

  const message = await adoptSeedIfUnseeded(lake);

  expect(message).toContain("dev:seed");
  expect(await publishedBuildId(lake)).toBeNull();
});

test("refuses to copy a seed that has no published build", async () => {
  await mkdir(seedLakeDir(), { recursive: true });
  const lake = path.join(workspace, "checkout", "report-lake");
  await expect(copySeedInto(lake)).rejects.toThrow("No published build");
});

test("discards staging left behind by an interrupted copy", async () => {
  await writeLake(seedLakeDir(), "seed-0001");
  const lake = path.join(workspace, "checkout", "report-lake");
  // What an interrupted earlier run leaves: a partial tree carrying a CURRENT
  // that names a build whose files never finished copying.
  await writeLake(`${lake}.seeding`, "interrupted-0001");
  await rm(path.join(`${lake}.seeding`, "builds", "interrupted-0001"), {
    recursive: true,
  });

  await copySeedInto(lake);

  expect(await publishedBuildId(lake)).toBe("seed-0001");
  expect(await Bun.file(`${lake}.seeding/CURRENT`).exists()).toBe(false);
});
