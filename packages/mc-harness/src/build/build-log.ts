/**
 * The build journal: an append-only `journal.jsonl` in the build directory.
 * Every command that changes or looks at the build appends a line, so a
 * session can be resumed, graded and compared from what actually happened
 * rather than from what the agent remembers.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { withPublicationLock } from "#protocol/publication-lock.ts";
import {
  BUILD_FILES,
  BuildLogEntrySchema,
  type BuildLogEntry,
} from "#protocol/build.ts";

export async function readLog(dir: string): Promise<BuildLogEntry[]> {
  const file = Bun.file(path.join(dir, BUILD_FILES.journal));
  if (!(await file.exists())) {
    return [];
  }
  const text = await file.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => BuildLogEntrySchema.parse(JSON.parse(line)));
}

/** The iteration a new entry belongs to: one more than the renders so far. */
export function iterationOf(entries: readonly BuildLogEntry[]): number {
  return entries.filter((entry) => entry.kind === "render").length;
}

/**
 * Appends one entry, stamping `at` and `iteration` from the log itself. An
 * entry about an earlier render (a critique of `--render v1` after v2 was
 * rendered) passes that render's iteration explicitly.
 */
export async function appendLog<K extends BuildLogEntry["kind"]>(
  dir: string,
  entry: Omit<Extract<BuildLogEntry, { kind: K }>, "at" | "iteration"> & {
    kind: K;
  },
  options: { iteration?: number } = {},
): Promise<BuildLogEntry> {
  await mkdir(dir, { recursive: true });
  return withPublicationLock(dir, async () => {
    const entries = await readLog(dir);
    // A render starts the next iteration; everything else belongs to the current one.
    const iteration =
      options.iteration ??
      iterationOf(entries) + (entry.kind === "render" ? 1 : 0);
    const full = BuildLogEntrySchema.parse({
      ...entry,
      at: new Date().toISOString(),
      iteration,
    });
    await appendFile(
      path.join(dir, BUILD_FILES.journal),
      `${JSON.stringify(full)}\n`,
    );
    return full;
  });
}

/** The last entry of a kind, or null; narrow on `kind` at the call site. */
export function lastOf(
  entries: readonly BuildLogEntry[],
  kind: BuildLogEntry["kind"],
): BuildLogEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === kind) {
      return entry;
    }
  }
  return null;
}

/** The newest run belonging to this capture; earlier runs remain historical evidence. */
export function currentRun(
  entries: readonly BuildLogEntry[],
): Extract<BuildLogEntry, { kind: "run" }> | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === "run") return entry;
    if (entry?.kind === "capture") return null;
  }
  return null;
}

/** Every entry of a kind, in order. */
export function allOf(
  entries: readonly BuildLogEntry[],
  kind: BuildLogEntry["kind"],
): BuildLogEntry[] {
  return entries.filter((entry) => entry.kind === kind);
}
