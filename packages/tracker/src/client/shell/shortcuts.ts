import { useCallback, useRef } from "react";

export const shortcutHelp = [
  ["⌘ K", "Search and commands"],
  ["C", "Create issue"],
  ["/", "Search issues"],
  ["J / K", "Next / previous issue"],
  ["Enter", "Open selected issue"],
  ["Esc", "Close overlay / back"],
  ["S", "Set status"],
  ["P", "Set priority"],
  ["A", "Set assignee"],
  ["L", "Set labels"],
  ["Shift P", "Set project"],
  ["V", "Vote"],
  ["E", "Edit description"],
  ["⌘ Enter", "Submit editor"],
  ["G I / G B", "Issues / board"],
  ["G P / G A / G M", "Projects / activity / my issues"],
  ["[ / ]", "Previous / next issue"],
  ["?", "Keyboard shortcuts"],
];

const editable = "input, textarea, select, [contenteditable=true]";
// Enter already activates these; the shortcut must not take it from them.
const activatable = "a[href], button, summary, [role=button], [role=option]";
const rowLink = "a[data-issue-row]";
const rowArrows: Record<string, string> = { ArrowDown: "j", ArrowUp: "k" };

function shortcutKey(event: KeyboardEvent, target: Element | null) {
  return target?.closest(rowLink) == null
    ? event.key
    : (rowArrows[event.key] ?? event.key);
}

const isPaletteChord = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "k" &&
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  !event.shiftKey;

/** The key to act on, or undefined when it belongs to the browser or a field. */
function plainKey(event: KeyboardEvent) {
  // Leave every other chord (copy, select all, browser back…) alone.
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(editable) != null ||
    document.querySelector('[role="dialog"]:not(.peek)') !== null
  ) {
    return;
  }
  const key = shortcutKey(event, target);
  return key === "Enter" && target?.closest(activatable) != null
    ? undefined
    : key;
}

/**
 * Single-key shortcuts for the whole app. `action` reports whether the key
 * did something; only then is the browser's own handling suppressed.
 */
export function useShortcuts(
  action: (key: string) => boolean,
  modalOpen: boolean,
) {
  const pending = useRef(0);
  const current = useRef({ action, modalOpen });
  current.current = { action, modalOpen };
  return useCallback((element: HTMLDivElement | null) => {
    if (element === null) {
      return;
    }
    function keydown(event: KeyboardEvent) {
      const { action: handle, modalOpen: blocked } = current.current;
      if (isPaletteChord(event)) {
        event.preventDefault();
        handle("palette");
        return;
      }
      const key = blocked ? undefined : plainKey(event);
      if (key === undefined) {
        return;
      }
      const chord =
        pending.current > performance.now() &&
        ["i", "b", "p", "a", "m"].includes(key);
      pending.current = !chord && key === "g" ? performance.now() + 900 : 0;
      if (handle(chord ? `g${key}` : key)) {
        event.preventDefault();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
    };
  }, []);
}
