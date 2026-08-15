import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

/**
 * A machine-wide seed copy of the report lake, shared by every checkout.
 *
 * The lake is disposable derived data, but building one is not cheap: a full
 * rebuild walks the whole raw match/prematch corpus in S3. `REPORT_LAKE_DIR`
 * defaults to `./report-lake` relative to the backend's cwd, so every worktree
 * and every Conductor workspace gets its own empty one and every agent pays
 * that walk again.
 *
 * The seed is deliberately a *copy source*, not a shared working directory.
 * A running backend folds staged rows into a new build every 15 minutes and
 * garbage-collects old builds, so several backends pointed at one directory
 * would publish and collect concurrently over each other. Each checkout gets
 * its own working lake cloned from the seed instead.
 */

/** `<data>/scout-for-lol/dev-seed` — outside any checkout, so it survives them. */
export function seedRoot(): string {
  const xdg = Bun.env["XDG_DATA_HOME"];
  const base =
    xdg !== undefined && xdg.length > 0
      ? xdg
      : path.join(homedir(), ".local", "share");
  return path.join(base, "scout-for-lol", "dev-seed");
}

export function seedLakeDir(): string {
  return path.join(seedRoot(), "report-lake");
}

/**
 * Whether a lake directory holds a build a query could actually read.
 *
 * The four staging subdirectories are created on backend startup, so a
 * directory existing says nothing. `CURRENT` naming a build directory that
 * exists is the real test — it is exactly what the reader resolves per query.
 */
export async function publishedBuildId(
  lakeDir: string,
): Promise<string | null> {
  const pointer = Bun.file(path.join(lakeDir, "CURRENT"));
  if (!(await pointer.exists())) {
    return null;
  }
  const pointerText = await pointer.text();
  const buildId = pointerText.trim();
  if (buildId.length === 0) {
    return null;
  }
  const build = await stat(path.join(lakeDir, "builds", buildId)).catch(
    () => null,
  );
  return build?.isDirectory() === true ? buildId : null;
}

/**
 * Copy the shared seed into `lakeDir`, replacing whatever is there.
 *
 * Copies to a sibling and renames, so an interrupted copy cannot leave a
 * half-written tree behind a `CURRENT` that claims it is complete.
 */
export async function copySeedInto(lakeDir: string): Promise<string> {
  const seed = seedLakeDir();
  const buildId = await publishedBuildId(seed);
  if (buildId === null) {
    throw new Error(
      `No published build in the shared seed at ${seed}. Run \`bun run dev:seed\` first.`,
    );
  }

  const staging = `${lakeDir}.seeding`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(path.dirname(lakeDir), { recursive: true });
  await cp(seed, staging, { recursive: true });
  await rm(lakeDir, { recursive: true, force: true });
  await rename(staging, lakeDir);
  return buildId;
}

/**
 * Give this checkout a lake to read, if it has none and the seed does.
 *
 * A missing seed is not an error — it is the state before anyone has run
 * `dev:seed` — so this reports what it did and lets dev boot against an empty
 * lake, exactly as it did before the seed existed.
 */
export async function adoptSeedIfUnseeded(lakeDir: string): Promise<string> {
  const existing = await publishedBuildId(lakeDir);
  if (existing !== null) {
    return `report lake: using this checkout's build ${existing}`;
  }
  if ((await publishedBuildId(seedLakeDir())) === null) {
    return `report lake: empty, and no shared seed at ${seedLakeDir()} — run \`bun run dev:seed\` to build one (queries will return no rows until then)`;
  }
  const adopted = await copySeedInto(lakeDir);
  return `report lake: seeded build ${adopted} from ${seedLakeDir()}`;
}
