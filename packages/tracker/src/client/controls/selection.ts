import { useSyncExternalStore } from "react";

/**
 * The issues picked for a bulk action. `anchor` is where a Shift range
 * starts; `base` is what was picked before that range, so extending the
 * range back over itself shrinks it again.
 */
export type Selection = {
  ids: ReadonlySet<string>;
  anchor: string | undefined;
  base: ReadonlySet<string>;
};

export const emptySelection: Selection = {
  ids: new Set(),
  anchor: undefined,
  base: new Set(),
};

/** Pick or unpick one issue; it becomes the anchor of the next range. */
export function toggleSelected(selection: Selection, id: string): Selection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) {
    ids.delete(id);
  } else {
    ids.add(id);
  }
  return { ids, anchor: id, base: ids };
}

/**
 * Pick every issue between the anchor and `to`, in the order the list shows
 * them. Without an anchor the range starts at `from`, the focused issue.
 */
export function extendSelection(
  selection: Selection,
  order: readonly string[],
  from: string,
  to: string,
): Selection {
  const kept =
    selection.anchor !== undefined && order.includes(selection.anchor);
  const anchor = kept ? (selection.anchor ?? from) : from;
  const base = kept ? selection.base : selection.ids;
  const start = order.indexOf(anchor);
  const end = order.indexOf(to);
  if (start === -1 || end === -1) {
    return selection;
  }
  const range = order.slice(Math.min(start, end), Math.max(start, end) + 1);
  return { ids: new Set([...base, ...range]), anchor, base };
}

export function selectAll(order: readonly string[]): Selection {
  const ids = new Set(order);
  return { ids, anchor: undefined, base: ids };
}

/** The picked issues the list still shows, in its order. */
export function selectedInOrder(
  selection: Selection,
  order: readonly string[],
): string[] {
  return order.filter((id) => selection.ids.has(id));
}

/**
 * The selection belongs to one list: changing filters, grouping or view
 * starts a fresh one, while opening a peek keeps it.
 */
type Snapshot = { scope: string; selection: Selection };
let snapshot: Snapshot = { scope: "", selection: emptySelection };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const selectionStore = {
  read(scope: string) {
    return snapshot.scope === scope ? snapshot.selection : emptySelection;
  },
  update(scope: string, change: (selection: Selection) => Selection) {
    const next = change(selectionStore.read(scope));
    if (next === snapshot.selection && scope === snapshot.scope) {
      return;
    }
    snapshot = { scope, selection: next };
    for (const listener of listeners) {
      listener();
    }
  },
};

export function useSelection(scope: string) {
  const current = useSyncExternalStore(subscribe, () => snapshot);
  return current.scope === scope ? current.selection : emptySelection;
}

/** The list a selection belongs to: its address without the peek. */
export function selectionScope(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  params.delete("peek");
  return `${pathname}?${params.toString()}`;
}
