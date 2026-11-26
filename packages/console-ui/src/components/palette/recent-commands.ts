import { z } from "zod";

/** The ids of recently run palette commands, newest first. */
export type RecentCommands = {
  readonly ids: () => readonly string[];
  readonly remember: (id: string) => void;
  readonly clear: () => void;
};

export type RecentCommandsOptions = {
  /** The `localStorage` key, e.g. `"hub-palette-recent"`. */
  readonly key: string;
  /** How many to keep (5). */
  readonly limit?: number;
  /** Where they are kept; `localStorage` by default, memory without one. */
  readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
};

const StoredIds = z.array(z.string());

function readIds(
  storage: RecentCommandsOptions["storage"],
  key: string,
): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    const ids = StoredIds.safeParse(parsed);
    return ids.success ? ids.data : [];
  } catch {
    // Private windows and blocked storage read as no history.
    return [];
  }
}

function defaultStorage(): RecentCommandsOptions["storage"] {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Remembers which palette commands ran, so an empty palette can offer them
 * first. A per-viewer convenience: storage failures only lose the history.
 */
export function createRecentCommands({
  key,
  limit = 5,
  storage = defaultStorage(),
}: RecentCommandsOptions): RecentCommands {
  let memory = readIds(storage, key);
  function write(next: string[]): void {
    memory = next;
    try {
      storage?.setItem(key, JSON.stringify(next));
    } catch {
      // A full or blocked store keeps the in-memory list for this visit.
    }
  }
  return {
    ids: () => memory,
    remember: (id) => {
      write([id, ...memory.filter((known) => known !== id)].slice(0, limit));
    },
    clear: () => {
      memory = [];
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}
