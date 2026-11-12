import { z } from "zod";

const prefix = "tracker.list.";
const indexKey = `${prefix}index`;
const kept = 30;
const ListRestoreSchema = z.object({
  /** The address the list was at; the first entry of a tab reuses its key. */
  url: z.string(),
  /**
   * How far the window was scrolled. Only a first guess: rows are measured
   * as they render, so the same pixels can show different rows.
   */
  offset: z.number().nonnegative(),
  /**
   * The first row on screen and where its top edge sat in the viewport. The
   * list is restored by putting that row back there.
   */
  anchor: z.object({ identifier: z.string(), top: z.number() }).optional(),
  /** How many pages were loaded, so a reload fetches as far again. */
  pages: z.number().int().nonnegative(),
  /** The height of the whole list, reserved until those pages arrive. */
  size: z.number().nonnegative(),
  /** Measured row heights by position, so offsets land where they did. */
  sizes: z.array(z.number().nonnegative()),
});
export type ListRestore = z.infer<typeof ListRestoreSchema>;
const IndexSchema = z.array(z.string());
type RestoreStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * What a windowed list needs to stand where it stood for one history entry.
 * The router restores scroll on its own, but only once and only as far as
 * the page is tall, and a list whose pages are not loaded yet is short.
 */
export function createListRestore(storage: () => RestoreStorage) {
  function index() {
    const saved = storage().getItem(indexKey);
    return saved === null ? [] : IndexSchema.parse(JSON.parse(saved));
  }
  return {
    /** The state saved for this history entry, if it was at this address. */
    read(historyKey: string, url: string): ListRestore | undefined {
      const saved = storage().getItem(prefix + historyKey);
      if (saved === null) {
        return undefined;
      }
      const state = ListRestoreSchema.parse(JSON.parse(saved));
      return state.url === url ? state : undefined;
    },
    forget(historyKey: string) {
      storage().removeItem(prefix + historyKey);
    },
    /** Remember one entry, forgetting the oldest beyond a small budget. */
    save(historyKey: string, state: ListRestore) {
      const store = storage();
      const keys = [...index().filter((key) => key !== historyKey), historyKey];
      for (const stale of keys.splice(0, Math.max(0, keys.length - kept))) {
        store.removeItem(prefix + stale);
      }
      store.setItem(prefix + historyKey, JSON.stringify(state));
      store.setItem(indexKey, JSON.stringify(keys));
    },
  };
}

export const listRestore = createListRestore(() => sessionStorage);
