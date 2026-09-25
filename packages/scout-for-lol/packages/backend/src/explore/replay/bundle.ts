import { appendFile, mkdir, stat, readdir, chmod } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { REPLAY_SIGNALS } from "#src/explore/replay/signals.ts";

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
 *
 * `.git` takes two forms and both count. In an ordinary clone it is a
 * directory; in a linked worktree it is a *file* holding `gitdir: …`. Missing
 * the file form would leave the check passing in exactly the setup this
 * repository is developed in, which is the setup it most needs to catch.
 */
export async function isInsideGitCheckout(dir: string): Promise<boolean> {
  let current = path.resolve(dir);
  for (;;) {
    const gitPath = path.join(current, ".git");
    try {
      const gitStat = await stat(gitPath);
      if (gitStat.isDirectory() || gitStat.isFile()) return true;
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

/**
 * Append one line to the resume index, keeping its mode.
 *
 * A real `O_APPEND` write, not read-then-rewrite. Cases run four at a time by
 * default, and two workers finishing together would each read the same file,
 * each rewrite it, and one entry would vanish — leaving a case whose result
 * file exists but which `--resume` would pay to run again.
 */
export async function appendBundleLine(
  filePath: string,
  line: string,
): Promise<void> {
  // `mode` applies only when this call creates the file; an existing one keeps
  // what it has, which the location check already requires to be 0600.
  await appendFile(filePath, `${line}\n`, { mode: FILE_MODE });
  await chmod(filePath, FILE_MODE);
}

export const ReplayManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    startedAt: z.iso.datetime(),
    stage: z.enum(["beta", "prod"]),
    /**
     * The guild's label in the pin: "mine", "prod-top-1", …
     *
     * A rank label, not an identity. `capture-pin.ts` assigns "prod-top-1" to
     * whichever guild is busiest in the snapshot it is capturing, so the same
     * label can name different guilds in two pins. Anything that has to mean
     * "the same guild" compares `guildId`, never this.
     */
    profile: z.string().min(1),
    /** The guild this bundle actually ran as. The identity `profile` is not. */
    guildId: z.string().min(1),
    /** What the profile promised, as resolved and asserted per case. */
    expectedCapabilities: z.record(z.string(), z.boolean()),
    lake: z
      .object({
        buildId: z.string().min(1),
        puuidRemapFingerprint: z.string().min(1),
      })
      .strict(),
    database: z
      .object({
        name: z.string().min(1),
        /**
         * The snapshot database's own identity, from the dataset pin.
         *
         * The name is reusable — `scout_beta_snapshot` is restored in place on
         * every pull — so it identifies the slot, not the contents. Two runs
         * can share a name and a lake build while the relational rows behind
         * bucks, challenges and conversations have been replaced underneath
         * them. Postgres gives a recreated database a fresh OID, so this
         * distinguishes a snapshot from its replacement; a capture timestamp
         * would only describe when the pin was written.
         */
        snapshotId: z.string().min(1),
      })
      .strict(),
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
/**
 * The candidate side of a stored case record.
 *
 * Declared once because two readers parse it: the run, loading an earlier
 * bundle as a `--baseline`, and the summariser, re-scoring from stored
 * evidence. A second copy would let one of them drift into reading a field the
 * other does not write.
 *
 * Loose on purpose — a bundle written by a later version may carry fields this
 * reader has never heard of, and refusing to read it would make old evidence
 * unreadable for no gain.
 */
export const ReplayCaseCandidateSchema = z
  .object({
    answer: z.string().nullable(),
    queryText: z.string().nullable(),
    caveats: z.array(z.string()),
    followUps: z.array(z.string()),
    rowsReturned: z.number().nullable(),
    rowsScanned: z.number().nullable(),
    toolNames: z.array(z.string()),
    matchCardIds: z.array(z.string()),
    visualizationKind: z.string().nullable(),
  })
  .loose();

export type ReplayCaseCandidate = z.infer<typeof ReplayCaseCandidateSchema>;

export const ReplayCaseIndexEntrySchema = z
  .object({
    caseId: z.string().min(1),
    kind: z.enum(["chip", "conversation"]),
    status: z.enum(["ok", "error", "timeout", "skipped"]),
    durationMs: z.number().int().nonnegative(),
    /**
     * The signals this case produced, as signals — not free strings.
     *
     * A resume derives its prior integrity failures from these. Accepting an
     * unknown value and dropping it would let a corrupted `new_turn_errored`
     * quietly reduce that count to zero and a resumed summary report
     * `passed: true` over a run that had already failed.
     */
    signals: z.array(z.enum(REPLAY_SIGNALS)),
  })
  .strict();

export type ReplayCaseIndexEntry = z.infer<typeof ReplayCaseIndexEntrySchema>;

/**
 * Reasons this run id may not name a bundle directory.
 *
 * A run id becomes a path. `--resume ../../somewhere` would escape the bundle
 * root, and the directory is created and chmodded to 0700 before any manifest
 * is read — so a typo could mutate an arbitrary directory the user can write.
 * Checked as a name rather than by resolving, because the safe answer here is
 * narrow: the ids this harness mints are `<stage>-<label>-<stamp>`.
 */
export function runIdIssues(runId: string): readonly string[] {
  const issues: string[] = [];
  if (runId.trim() === "") issues.push("it is empty");
  if (runId !== runId.trim()) issues.push("it has leading or trailing spaces");
  if (runId.includes("/") || runId.includes("\\")) {
    issues.push("it contains a path separator");
  }
  if (runId === "." || runId === ".." || runId.startsWith("..")) {
    issues.push("it is a traversal component");
  }
  if (runId.startsWith("-")) issues.push("it starts with a dash");
  if (!/^[\w.-]+$/.test(runId)) {
    issues.push(
      "it has characters outside letters, digits, dot, dash and underscore",
    );
  }
  return issues;
}

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

/**
 * Every well-formed entry already recorded in this run.
 *
 * A resume needs more than the ids. The cases it skips still happened, and
 * their signals still count: a run whose first half errored and whose second
 * half was clean is not a clean run, and deriving the verdict from only the
 * newly executed cases would certify it as one.
 */
export async function recordedCaseEntries(
  indexPath: string,
): Promise<readonly ReplayCaseIndexEntry[]> {
  const file = Bun.file(indexPath);
  if (!(await file.exists())) return [];
  const indexText = await file.text();
  const lines = indexText.split("\n").filter((line) => line.trim() !== "");
  const entries: ReplayCaseIndexEntry[] = [];
  for (const [index, line] of lines.entries()) {
    // A truncated *final* line is expected after an interrupted run: the
    // append did not complete, so that case has to run again. Anywhere else a
    // malformed line means the index itself is damaged, and silently dropping
    // it would re-run a case at live-model cost and lose whatever integrity
    // failure it recorded — a resumed summary would then certify a run whose
    // evidence is missing. So only the last line may be partial.
    const isFinal = index === lines.length - 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      if (isFinal) continue;
      throw new Error(
        `${indexPath} line ${(index + 1).toString()} is not valid JSON. Only a truncated final line is recoverable; this index is damaged.`,
      );
    }
    // Only a *byte-truncated* line is recoverable, and that fails JSON parsing
    // above. A line that parses as JSON was written whole, so a shape the
    // schema rejects means the index is damaged rather than interrupted —
    // discarding it would re-run the case and drop the integrity failure it
    // recorded, even on the last line.
    const parsed = ReplayCaseIndexEntrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${indexPath} line ${(index + 1).toString()} is not a valid case entry: ${parsed.error.message}`,
      );
    }
    entries.push(parsed.data);
  }
  return entries;
}

/** Case ids already recorded in this run, so a resume can skip them. */
export async function completedCaseIds(
  indexPath: string,
): Promise<ReadonlySet<string>> {
  const entries = await recordedCaseEntries(indexPath);
  return new Set(entries.map((entry) => entry.caseId));
}
