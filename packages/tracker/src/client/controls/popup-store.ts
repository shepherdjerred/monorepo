import { useSyncExternalStore } from "react";

/** The page's own host; a dialog's host has the dialog's `pickerScope`. */
export const pageScope = "page";

export type PopupEntry<T> = {
  id: number;
  request: T;
  open: boolean;
  /** The host that renders it: the page, or the dialog the anchor is in. */
  scope: string;
};

/**
 * One popup that any control can open at itself, rendered by one host. A
 * dialog traps focus and treats anything outside it as outside, so a popup
 * opened from within one is rendered by that dialog's own host.
 */
export function createPopupStore<T extends { anchor: HTMLElement }>() {
  let current: PopupEntry<T> | undefined;
  let nextId = 1;
  const listeners = new Set<() => void>();
  function publish(next: PopupEntry<T> | undefined) {
    current = next;
    for (const listener of listeners) {
      listener();
    }
  }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  return {
    open(request: T) {
      const scope =
        request.anchor.closest<HTMLElement>("[data-picker-scope]")?.dataset[
          "pickerScope"
        ] ?? pageScope;
      publish({ id: nextId, request, open: true, scope });
      nextId += 1;
    },
    /** Start closing; the host keeps it mounted while it animates out. */
    close(id: number) {
      if (current?.id === id) {
        publish({ ...current, open: false });
      }
    },
    /** Unmount it once it has closed. */
    forget(id: number) {
      if (current?.id === id && !current.open) {
        publish(undefined);
      }
    },
    /** The popup this host renders, if it was opened within its scope. */
    useEntry(scope: string) {
      const entry = useSyncExternalStore(subscribe, () => current);
      return entry?.scope === scope ? entry : undefined;
    },
  };
}
