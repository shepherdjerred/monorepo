import { useCallback, useRef, type RefObject } from "react";
import type { EntryListItem } from "@shepherdjerred/feeds/shared/contract.ts";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "input, select, textarea, dialog, [contenteditable='true']",
    ) !== null
  );
}

function shouldIgnoreGlobalKey(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isEditableTarget(event.target) ||
    document.querySelector("dialog[open]") !== null
  );
}

type EntryShortcutContext = {
  readonly entries: readonly EntryListItem[];
  readonly activeIndex: number | undefined;
  readonly setActiveIndex: React.Dispatch<
    React.SetStateAction<number | undefined>
  >;
  readonly onToggleRead: (entry: EntryListItem) => void;
  readonly onToggleStar: (entry: EntryListItem) => void;
  readonly onFocusSearch: () => void;
};

function handleEntryShortcut(
  key: string,
  context: EntryShortcutContext,
): boolean {
  if (key === "/") {
    context.onFocusSearch();
    return true;
  }
  const { entries, activeIndex, setActiveIndex } = context;
  if (entries.length === 0) return false;
  if (key === "j") {
    setActiveIndex((prev) =>
      prev === undefined ? 0 : Math.min(entries.length - 1, prev + 1),
    );
    return true;
  }
  if (key === "k") {
    setActiveIndex((prev) => (prev === undefined ? 0 : Math.max(0, prev - 1)));
    return true;
  }
  const active = activeIndex === undefined ? undefined : entries[activeIndex];
  if (active === undefined) return false;
  if (key === "o") {
    globalThis.open(active.url, "_blank", "noopener,noreferrer");
    return true;
  }
  if (key === "m") {
    context.onToggleRead(active);
    return true;
  }
  if (key === "s") {
    context.onToggleStar(active);
    return true;
  }
  return false;
}

export function useWorkspaceShortcuts(options: {
  readonly isEntriesRoute: boolean;
  readonly entries: readonly EntryListItem[];
  readonly activeIndex: number | undefined;
  readonly setActiveIndex: React.Dispatch<
    React.SetStateAction<number | undefined>
  >;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly onToggleRead: (entry: EntryListItem) => void;
  readonly onToggleStar: (entry: EntryListItem) => void;
  readonly onRefresh: () => void;
}): (element: HTMLElement | null) => (() => void) | undefined {
  const latest = useRef(options);
  latest.current = options;
  // Attached to the workspace element: the window listener lives exactly as
  // long as the workspace is mounted.
  return useCallback((element: HTMLElement | null) => {
    if (element === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const current = latest.current;
      if (shouldIgnoreGlobalKey(event)) return;
      if (event.key === "r") {
        event.preventDefault();
        current.onRefresh();
        return;
      }
      if (!current.isEntriesRoute) return;
      const handled = handleEntryShortcut(event.key, {
        entries: current.entries,
        activeIndex: current.activeIndex,
        setActiveIndex: current.setActiveIndex,
        onToggleRead: current.onToggleRead,
        onToggleStar: current.onToggleStar,
        onFocusSearch: () => {
          current.searchInputRef.current?.focus();
          current.searchInputRef.current?.select();
        },
      });
      if (handled) event.preventDefault();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
