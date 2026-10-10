import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  BUILD_FILES,
  BuildLogEntrySchema,
  type BuildLogEntry,
} from "#protocol/build.ts";
import { isDeepStrictEqual } from "node:util";
import { appendLog, readLog } from "#build/build-log.ts";
import type { BuildWorkspace } from "#build/workspace.ts";

/** List only generated regular files; transaction staging never follows symlinks. */
export async function stagedFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)),
    );
}

/** Append to a staged copy so journal failure cannot leave new evidence installed. */
export async function stageJournal<K extends BuildLogEntry["kind"]>(
  source: BuildWorkspace,
  pending: BuildWorkspace,
  entry: Omit<Extract<BuildLogEntry, { kind: K }>, "at" | "iteration"> & {
    kind: K;
  },
  options: { iteration?: number } = {},
): Promise<void> {
  const journal = source.file(BUILD_FILES.journal);
  if (await Bun.file(journal).exists())
    await Bun.write(
      pending.file(BUILD_FILES.journal),
      await Bun.file(journal).bytes(),
    );
  const existing = await readLog(source.dir);
  // A process exit after installing the journal may leave a recoverable critique bundle.
  if (entry.kind === "critique" && "file" in entry) {
    const matches = existing.filter(
      (item) => item.kind === "critique" && item.file === entry.file,
    );
    if (matches.length > 1)
      throw new Error("duplicate prepared critique journal entry");
    const match = matches[0];
    if (match !== undefined) {
      const expected = BuildLogEntrySchema.parse({
        ...entry,
        at: match.at,
        iteration: options.iteration ?? match.iteration,
      });
      if (!isDeepStrictEqual(match, expected))
        throw new Error(
          "prepared critique journal entry does not match its verdict",
        );
      return;
    }
  }
  await appendLog<K>(pending.dir, entry, options);
}
