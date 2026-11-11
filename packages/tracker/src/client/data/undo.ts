type UndoEntry = { id: number; run: () => void };

/**
 * The actions that can still be undone, oldest first. An entry lives exactly
 * as long as the toast offering it, so `Cmd/Ctrl+Z` never undoes something
 * the screen no longer mentions.
 */
export function createUndoStack() {
  const entries: UndoEntry[] = [];
  let nextId = 1;

  function take(index: number) {
    const entry = entries[index];
    if (entry === undefined) {
      return false;
    }
    entries.splice(index, 1);
    entry.run();
    return true;
  }

  return {
    /** Offer an undo; the returned id withdraws or runs it. */
    offer(run: () => void) {
      const id = nextId;
      nextId += 1;
      entries.push({ id, run });
      return id;
    },
    /** Withdraw an offer without running it. */
    withdraw(id: number) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index !== -1) {
        entries.splice(index, 1);
      }
    },
    /** Run one offer; false when it was already run or withdrawn. */
    run(id: number) {
      return take(entries.findIndex((entry) => entry.id === id));
    },
    /** Run the newest offer; false when nothing can be undone. */
    runNewest() {
      return take(entries.length - 1);
    },
    get size() {
      return entries.length;
    },
  };
}

export const undoStack = createUndoStack();
