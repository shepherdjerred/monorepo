/**
 * Append-only journal of every live write: one JSON line per write, undo or
 * backup in ~/.toolkit/mc/journal/live/<UTC date>.jsonl. Lines are never
 * rewritten; an undo is its own line pointing at the write it reverted.
 */
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  type LiveJournalEntry,
  LiveJournalEntrySchema,
} from "#protocol/live.ts";
import { JOURNAL_DIR } from "#protocol/paths.ts";
import { boxesOverlap } from "#src/box.ts";

export const LIVE_JOURNAL_DIR = path.join(JOURNAL_DIR, "live");

export function newLiveJournalId(now: Date): string {
  return `lj-${now.getTime().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export class LiveJournal {
  constructor(readonly dir = LIVE_JOURNAL_DIR) {}

  private file(ts: string): string {
    return path.join(this.dir, `${ts.slice(0, 10)}.jsonl`);
  }

  async append(entry: LiveJournalEntry): Promise<void> {
    const parsed = LiveJournalEntrySchema.parse(entry);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await appendFile(this.file(parsed.ts), `${JSON.stringify(parsed)}\n`, {
      mode: 0o600,
    });
  }

  /** Every entry, oldest first; `since` filters by timestamp. */
  async list(since?: Date): Promise<LiveJournalEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
    const entries: LiveJournalEntry[] = [];
    for (const name of names
      .filter((file) => file.endsWith(".jsonl"))
      .toSorted()) {
      const text = await Bun.file(path.join(this.dir, name)).text();
      for (const line of text.split("\n")) {
        if (line.trim().length > 0) {
          entries.push(LiveJournalEntrySchema.parse(JSON.parse(line)));
        }
      }
    }
    const sorted = entries.toSorted((a, b) => a.ts.localeCompare(b.ts));
    return since === undefined
      ? sorted
      : sorted.filter((entry) => new Date(entry.ts) >= since);
  }

  async find(id: string): Promise<LiveJournalEntry> {
    const entries = await this.list();
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      throw new Error(`No live journal entry ${id}`);
    }
    return entry;
  }
}

/** Ids of writes an undo line has reverted. */
export function undoneIds(entries: readonly LiveJournalEntry[]): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.kind === "undo" && entry.result === "ok" && entry.undoes !== null
        ? [entry.undoes]
        : [],
    ),
  );
}

/**
 * Why `target` cannot be undone yet, or null. Undo is last-in-first-out:
 * a later successful block write overlapping the same box must be undone
 * first, or restoring the older snapshot would clobber it.
 */
export function undoBlocker(
  entries: readonly LiveJournalEntry[],
  target: LiveJournalEntry,
): string | null {
  if (target.kind !== "write" || target.result !== "ok") {
    return `${target.id} is not a successful write`;
  }
  if (target.snapshotId === null || target.box === null) {
    return `${target.id} changed no blocks (no snapshot to restore); revert it by hand`;
  }
  const undone = undoneIds(entries);
  if (undone.has(target.id)) {
    return `${target.id} is already undone`;
  }
  const box = target.box;
  const later = entries.filter(
    (entry) =>
      entry.kind === "write" &&
      entry.result === "ok" &&
      entry.ts > target.ts &&
      entry.box !== null &&
      entry.snapshotId !== null &&
      !undone.has(entry.id) &&
      boxesOverlap(entry.box, box),
  );
  return later.length === 0
    ? null
    : `undo is last-in-first-out: undo ${later.map((entry) => entry.id).join(", ")} first (they overlap ${target.id})`;
}
