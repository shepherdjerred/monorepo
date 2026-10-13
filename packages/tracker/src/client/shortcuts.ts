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

export function useShortcuts(
  action: (key: string) => void,
  modalOpen: boolean,
) {
  const pending = useRef(0);
  const current = useRef({ action, modalOpen });
  current.current = { action, modalOpen };
  return useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    function keydown(event: KeyboardEvent) {
      const { action: handle, modalOpen: blocked } = current.current;
      const key = event.key;
      if (key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handle("palette");
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]") !==
          null
      )
        return;
      if (
        blocked ||
        document.querySelector('[role="dialog"]:not(.peek)') !== null
      )
        return;
      if (
        pending.current > performance.now() &&
        ["i", "b", "p", "a", "m"].includes(key)
      ) {
        pending.current = 0;
        event.preventDefault();
        handle(`g${key}`);
        return;
      }
      pending.current = key === "g" ? performance.now() + 900 : 0;
      if (
        [
          "c",
          "/",
          "j",
          "k",
          "Enter",
          "Escape",
          "s",
          "p",
          "P",
          "a",
          "l",
          "v",
          "e",
          "[",
          "]",
          "?",
        ].includes(key)
      ) {
        event.preventDefault();
        handle(key);
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
    };
  }, []);
}
