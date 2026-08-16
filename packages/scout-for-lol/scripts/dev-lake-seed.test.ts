import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  adoptSeedIfUnseeded,
  copySeedInto,
  publishedBuildId,
  resolveBackendLakeDir,
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

test("refuses a relative destination rather than resolving it here", async () => {
  await writeLake(seedLakeDir(), "seed-0001");
  await expect(copySeedInto("./report-lake")).rejects.toThrow(
    "Refusing to seed a relative report lake path",
  );
});

test("refuses the filesystem root", async () => {
  await writeLake(seedLakeDir(), "seed-0001");
  await expect(copySeedInto(path.parse(process.cwd()).root)).rejects.toThrow(
    "Refusing to seed the filesystem root",
  );
});

test("refuses a destination that contains the current directory", async () => {
  // What `REPORT_LAKE_DIR=..` resolves to: an ancestor of where this process
  // runs, so replacing it would delete the checkout itself. Asserted against a
  // synthetic ancestor rather than the real one — running the unguarded code
  // against process.cwd()'s parent genuinely deletes it.
  await writeLake(seedLakeDir(), "seed-0001");
  const nested = path.join(workspace, "checkout", "deep", "cwd");
  await mkdir(nested, { recursive: true });
  // process.cwd() reports the real path, and macOS resolves /var to
  // /private/var — compare against the realpath or the ancestor check silently
  // never matches and a different branch of the guard answers instead.
  const ancestor = path.dirname(path.dirname(await realpath(nested)));
  const originalCwd = process.cwd();
  process.chdir(nested);
  try {
    await expect(copySeedInto(ancestor)).rejects.toThrow(
      "it contains the current directory",
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test("refuses a non-empty directory that is not a report lake", async () => {
  await writeLake(seedLakeDir(), "seed-0001");
  const notALake = path.join(workspace, "someone-elses-data");
  await mkdir(notALake, { recursive: true });
  await writeFile(path.join(notALake, "important.txt"), "do not delete");

  await expect(copySeedInto(notALake)).rejects.toThrow(
    "does not look like a report lake",
  );
  expect(await Bun.file(path.join(notALake, "important.txt")).exists()).toBe(
    true,
  );
});

test("still replaces a real lake, and an empty directory", async () => {
  await writeLake(seedLakeDir(), "seed-0001");

  const realLake = path.join(workspace, "checkout-real", "report-lake");
  await writeLake(realLake, "old-0001");
  await copySeedInto(realLake);
  expect(await publishedBuildId(realLake)).toBe("seed-0001");

  const emptyDir = path.join(workspace, "empty", "report-lake");
  await mkdir(emptyDir, { recursive: true });
  await copySeedInto(emptyDir);
  expect(await publishedBuildId(emptyDir)).toBe("seed-0001");
});

test("resolves a relative REPORT_LAKE_DIR against the backend's cwd, not the caller's", () => {
  // The whole point: `dev:web` runs from the Scout package root while the
  // backend runs from `packages/backend`, so seeding the caller-relative path
  // would copy into — and, since the copy removes the destination first, delete
  // — a directory the backend never opens.
  expect(
    resolveBackendLakeDir("/repo/packages/backend", "./alternate-lake"),
  ).toBe("/repo/packages/backend/alternate-lake");
});

test("uses the backend's own default when REPORT_LAKE_DIR is unset or empty", () => {
  expect(resolveBackendLakeDir("/repo/packages/backend", undefined)).toBe(
    "/repo/packages/backend/report-lake",
  );
  expect(resolveBackendLakeDir("/repo/packages/backend", "")).toBe(
    "/repo/packages/backend/report-lake",
  );
});

test("leaves an absolute REPORT_LAKE_DIR exactly where it points", () => {
  expect(
    resolveBackendLakeDir("/repo/packages/backend", "/srv/shared/report-lake"),
  ).toBe("/srv/shared/report-lake");
});
