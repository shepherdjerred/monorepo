import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { directoryExists } from "#lib/tend/worktrees-git.ts";

/**
 * Which files of a worktree are already clones, so a later pass does not
 * clone them again (and make git re-hash them). An entry is only trusted
 * while the file still has the recorded inode, size and change time and the
 * index still names the recorded blob.
 *
 * The change time is what catches a write in place: a tool that rewrites a
 * clone, even with the same bytes, makes the filesystem give it blocks of
 * its own again while its inode and size stay as they were.
 *
 * This is a rebuildable cache: a missing or unreadable file costs one repeat
 * pass and nothing else.
 */
export type DedupeFileRecord = {
  readonly ino: number;
  readonly size: number;
  /** The file's ctime right after it was replaced. */
  readonly ctimeMs: number;
  readonly sha: string;
  /**
   * The file it was cloned from, as that file was then. Sharing takes two:
   * if the source is rewritten, or another worktree's copy is the canonical
   * one now, the pair no longer shares blocks although this file is
   * untouched.
   */
  readonly source: {
    readonly worktree: string;
    readonly ino: number;
    readonly ctimeMs: number;
  };
};

const DedupeStateSchema = z.strictObject({
  version: z.literal(2),
  worktree: z.string().min(1),
  files: z.record(
    z.string(),
    z.strictObject({
      ino: z.number(),
      size: z.number(),
      ctimeMs: z.number(),
      sha: z.string(),
      source: z.strictObject({
        worktree: z.string(),
        ino: z.number(),
        ctimeMs: z.number(),
      }),
    }),
  ),
});

export function dedupeStateFile(
  stateDir: string,
  worktreePath: string,
): string {
  const digest = createHash("sha256").update(worktreePath).digest("hex");
  return path.join(stateDir, `${digest.slice(0, 32)}.json`);
}

async function readStateDocument(
  file: string,
): Promise<z.infer<typeof DedupeStateSchema> | null> {
  try {
    const parsed = DedupeStateSchema.safeParse(
      JSON.parse(await Bun.file(file).text()),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readDedupeState(
  stateDir: string,
  worktreePath: string,
): Promise<Map<string, DedupeFileRecord>> {
  const document = await readStateDocument(
    dedupeStateFile(stateDir, worktreePath),
  );
  return document?.worktree === worktreePath
    ? new Map(Object.entries(document.files))
    : new Map();
}

export async function writeDedupeState(
  stateDir: string,
  worktreePath: string,
  files: ReadonlyMap<string, DedupeFileRecord>,
): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const file = dedupeStateFile(stateDir, worktreePath);
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await Bun.write(
    temporary,
    JSON.stringify({
      version: 2,
      worktree: worktreePath,
      files: Object.fromEntries(files),
    }),
  );
  await rename(temporary, file);
}

/** Drop state for worktrees that are gone, and anything unreadable. */
export async function pruneDedupeState(stateDir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(stateDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const file = path.join(stateDir, name);
    const document = await readStateDocument(file);
    if (document === null || !(await directoryExists(document.worktree))) {
      await rm(file, { force: true });
    }
  }
}
