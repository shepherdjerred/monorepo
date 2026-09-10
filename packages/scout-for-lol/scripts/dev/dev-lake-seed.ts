import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
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
 * The absolute directory the backend will actually open for `REPORT_LAKE_DIR`.
 *
 * The backend reads that variable as a plain string and defaults it to
 * `./report-lake`, so a relative value is resolved against *its* cwd —
 * `packages/backend` — not against whoever set it. Anything seeding the lake
 * before the backend starts runs from a different cwd, so it has to resolve the
 * value the same way or it operates on a directory the backend never reads.
 *
 * That is not just a wasted copy: `copySeedInto` removes the destination before
 * renaming the staged tree into place, so a mis-resolved relative path deletes
 * a directory nobody asked it to touch. Resolve once, then hand the absolute
 * result to the backend as well, so the two processes cannot disagree.
 */
export function resolveBackendLakeDir(
  backendCwd: string,
  configured: string | undefined,
): string {
  const value =
    configured !== undefined && configured.length > 0
      ? configured
      : "./report-lake";
  return path.resolve(backendCwd, value);
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
/**
 * Refuse to delete anything that is not plausibly a report lake.
 *
 * `copySeedInto` removes its destination outright, and that destination comes
 * from `REPORT_LAKE_DIR`. A value of `.`, `..`, or `/` therefore aims a
 * recursive delete at the repo or the filesystem root, and `dev:web` reaches
 * this path automatically whenever the destination looks unseeded. The
 * resolve-once rule in `resolveBackendLakeDir` keeps the two processes
 * agreeing on *which* directory; it does nothing about the value itself being
 * dangerous, so check that here — at the only place that deletes.
 */
async function assertSafeLakeTarget(lakeDir: string): Promise<void> {
  if (!path.isAbsolute(lakeDir)) {
    throw new Error(
      `Refusing to seed a relative report lake path ${lakeDir}: resolve it first with resolveBackendLakeDir().`,
    );
  }
  if (path.dirname(lakeDir) === lakeDir) {
    throw new Error(
      `Refusing to seed the filesystem root ${lakeDir} — check REPORT_LAKE_DIR.`,
    );
  }

  const cwd = process.cwd();
  if (cwd === lakeDir || cwd.startsWith(`${lakeDir}${path.sep}`)) {
    throw new Error(
      `Refusing to seed ${lakeDir}: it contains the current directory, so replacing it would delete this checkout. Check REPORT_LAKE_DIR.`,
    );
  }

  const existing = await stat(lakeDir).catch(() => null);
  if (existing === null) {
    return;
  }
  if (!existing.isDirectory()) {
    throw new Error(`Refusing to seed ${lakeDir}: it is not a directory.`);
  }

  // An empty or freshly-created directory is fine — that is the unseeded
  // case. What must never be deleted is a directory holding something else.
  const markers = [
    "CURRENT",
    "builds",
    "matches-recent",
    "prematch-recent",
    "competition-rank-history-recent",
  ];
  const present = await Promise.all(
    markers.map(
      async (marker) =>
        (await stat(path.join(lakeDir, marker)).catch(() => null)) !== null,
    ),
  );
  if (present.includes(true)) {
    return;
  }

  const entries = await readdir(lakeDir).catch(() => []);
  if (entries.length > 0) {
    throw new Error(
      `Refusing to seed ${lakeDir}: it holds ${entries.length.toString()} entries but none of ${markers.join(", ")}, so it does not look like a report lake. Check REPORT_LAKE_DIR.`,
    );
  }
}

export async function copySeedInto(lakeDir: string): Promise<string> {
  const seed = seedLakeDir();
  const buildId = await publishedBuildId(seed);
  if (buildId === null) {
    throw new Error(
      `No published build in the shared seed at ${seed}. Run \`bun run dev:seed\` first.`,
    );
  }

  await assertSafeLakeTarget(lakeDir);

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
