import { mkdir, stat, readdir, chmod } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

/**
 * Where a replay run is written, and the permissions it insists on first.
 *
 * A bundle holds the questions real people asked and the answers Scout gave
 * them, so it is a private local artifact rather than something that lands in
 * a checkout: committed transcripts would drag conversation text into git
 * history, and the corpus deliberately stores ids instead. The permission
 * check runs *before* the first model call, following the fleet run-bundle
 * rule — a run that would be unreadable or world-readable should cost nothing
 * before it fails.
 */

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** `$XDG_STATE_HOME/scout-for-lol/explore-replay`, outside any checkout. */
export function replayBundleRoot(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  const xdg = environment["XDG_STATE_HOME"];
  const base =
    xdg !== undefined && xdg.length > 0
      ? xdg
      : path.join(homedir(), ".local", "state");
  return path.join(base, "scout-for-lol", "explore-replay");
}

/**
 * A bundle root must not sit inside a git checkout.
 *
 * Not style: `git add -A` in a worktree whose state directory was pointed at
 * the repo would commit every transcript at once. Refusing the location is the
 * only check that happens before anything is written.
 */
export async function isInsideGitCheckout(dir: string): Promise<boolean> {
  let current = path.resolve(dir);
  for (;;) {
    if (await Bun.file(path.join(current, ".git", "HEAD")).exists()) {
      return true;
    }
    const gitDir = path.join(current, ".git");
    try {
      const gitDirStat = await stat(gitDir);
      if (gitDirStat.isDirectory()) return true;
    } catch {
      // No .git here; keep walking up.
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export type BundlePermissionIssue = string;

/**
 * Reasons this directory is not a safe place to write a bundle.
 *
 * Checks the mode bits rather than trusting the `mkdir` that created them: a
 * pre-existing directory from an earlier run, or one created under a different
 * umask, is exactly the case worth catching.
 */
export async function bundleLocationIssues(
  dir: string,
): Promise<readonly BundlePermissionIssue[]> {
  const issues: BundlePermissionIssue[] = [];
  if (await isInsideGitCheckout(dir)) {
    issues.push(
      `${dir} is inside a git checkout; replay bundles hold conversation text and must stay out of a repository`,
    );
  }
  let mode: number;
  try {
    const dirStat = await stat(dir);
    mode = dirStat.mode & 0o777;
  } catch {
    return [...issues, `${dir} does not exist`];
  }
  if (mode !== DIRECTORY_MODE) {
    issues.push(
      `${dir} has mode ${mode.toString(8)}, expected ${DIRECTORY_MODE.toString(8)}`,
    );
  }
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(dir, entry.name);
    const fileStat = await stat(filePath);
    const fileMode = fileStat.mode & 0o777;
    if (fileMode !== FILE_MODE) {
      issues.push(
        `${filePath} has mode ${fileMode.toString(8)}, expected ${FILE_MODE.toString(8)}`,
      );
    }
  }
  return issues;
}

/** Create the run directory with the modes the location check demands. */
export async function createBundleDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIRECTORY_MODE });
  // `mkdir`'s mode is masked by the umask, so set it explicitly afterwards
  // rather than hoping the caller's umask was 0o077.
  await chmod(dir, DIRECTORY_MODE);
}

/** Write a bundle file at 0600, creating it if absent. */
export async function writeBundleFile(
  filePath: string,
  contents: string,
): Promise<void> {
  await Bun.write(filePath, contents);
  await chmod(filePath, FILE_MODE);
}

/** Append one line to the resume index, keeping its mode. */
export async function appendBundleLine(
  filePath: string,
  line: string,
): Promise<void> {
  const existing = await Bun.file(filePath).exists();
  const previous = existing ? await Bun.file(filePath).text() : "";
  await writeBundleFile(filePath, `${previous}${line}\n`);
}

export const ReplayManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    startedAt: z.iso.datetime(),
    stage: z.enum(["beta", "prod"]),
    profile: z.string().min(1),
    /** What the profile promised, as resolved and asserted per case. */
    expectedCapabilities: z.record(z.string(), z.boolean()),
    lake: z
      .object({
        buildId: z.string().min(1),
        puuidRemapFingerprint: z.string().min(1),
      })
      .strict(),
    database: z.object({ name: z.string().min(1) }).strict(),
    model: z.string().min(1),
    chipCatalogSha256: z.string().regex(/^[0-9a-f]{64}$/),
    corpusSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    corpusVersion: z.number().int().positive().nullable(),
    promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
    flagOverrides: z.array(
      z.object({ flag: z.string(), value: z.boolean() }).strict(),
    ),
    /** Recorded because a sweep that silently hit the budget is not a result. */
    tokenBudgets: z
      .object({
        hourly: z.number().int().positive(),
        daily: z.number().int().positive(),
      })
      .strict(),
    gitCommit: z.string().min(1),
    concurrency: z.number().int().positive(),
    caseCount: z.number().int().nonnegative(),
    baselineRunId: z.string().min(1).nullable(),
  })
  .strict();

export type ReplayManifest = z.infer<typeof ReplayManifestSchema>;

/**
 * One line of `cases.jsonl`: enough to resume, not the whole record.
 *
 * A full matrix sweep is hours of live model spend and will be interrupted, so
 * the index is append-only and is read back to skip what already ran.
 */
export const ReplayCaseIndexEntrySchema = z
  .object({
    caseId: z.string().min(1),
    kind: z.enum(["chip", "conversation"]),
    status: z.enum(["ok", "error", "timeout", "skipped"]),
    durationMs: z.number().int().nonnegative(),
    signals: z.array(z.string()),
  })
  .strict();

export type ReplayCaseIndexEntry = z.infer<typeof ReplayCaseIndexEntrySchema>;

export function bundlePaths(runDir: string): {
  readonly manifest: string;
  readonly index: string;
  readonly summary: string;
  readonly caseFile: (caseId: string) => string;
} {
  return {
    manifest: path.join(runDir, "manifest.json"),
    index: path.join(runDir, "cases.jsonl"),
    summary: path.join(runDir, "summary.json"),
    // Case ids carry a colon, which is legal on the filesystems this runs on
    // but reads badly in a path; one substitution keeps the id recoverable.
    caseFile: (caseId: string) =>
      path.join(runDir, "cases", `${caseId.replaceAll(":", "_")}.json`),
  };
}

/** Case ids already recorded in this run, so a resume can skip them. */
export async function completedCaseIds(
  indexPath: string,
): Promise<ReadonlySet<string>> {
  const file = Bun.file(indexPath);
  if (!(await file.exists())) return new Set();
  const ids = new Set<string>();
  const indexText = await file.text();
  for (const line of indexText.split("\n")) {
    if (line.trim() === "") continue;
    // A truncated final line is expected after an interrupted run: the entry
    // did not complete, so the case has to run again. `JSON.parse` throws on
    // it, so the throw is caught here rather than failing the resume — but
    // only a well-formed, schema-valid entry counts as done, so a partial
    // record can never resume past a case that produced no result.
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = ReplayCaseIndexEntrySchema.safeParse(raw);
    if (parsed.success) ids.add(parsed.data.caseId);
  }
  return ids;
}
