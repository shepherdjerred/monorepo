import { mergeEntries, type HistoryEntry } from "./ops.ts";

/** A run of entries with one key closer together than this is one undo step. */
export const COALESCE_MS = 800;
const MAX_ENTRIES = 200;

export type History = {
  /** Records an applied edit; a new edit clears what could be redone. */
  readonly push: (entry: HistoryEntry) => void;
  /** The entry to undo (now on the redo stack), or null. */
  readonly undo: () => HistoryEntry | null;
  readonly redo: () => HistoryEntry | null;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
};

export function createHistory(): History {
  const done: HistoryEntry[] = [];
  const undone: HistoryEntry[] = [];
  return {
    push(entry) {
      undone.length = 0;
      const last = done.at(-1);
      if (
        last?.key !== null &&
        last?.key === entry.key &&
        entry.at - last.at < COALESCE_MS
      ) {
        done[done.length - 1] = mergeEntries(last, entry);
        return;
      }
      done.push(entry);
      if (done.length > MAX_ENTRIES) done.shift();
    },
    undo() {
      const entry = done.pop();
      if (entry === undefined) return null;
      undone.push(entry);
      return entry;
    },
    redo() {
      const entry = undone.pop();
      if (entry === undefined) return null;
      done.push(entry);
      return entry;
    },
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
  };
}
