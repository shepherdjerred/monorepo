import { useBeforeUnload, useBlocker } from "react-router";
import { useCallback, useEffect } from "react";

export function useDraftGuard(dirty: boolean) {
  const blocker = useBlocker(dirty);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!dirty) return;
        event.preventDefault();
      },
      [dirty],
    ),
  );
  return blocker;
}

function editing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ) !== null
  );
}

function focusAdjacentTask(direction: -1 | 1): void {
  const tasks = [...document.querySelectorAll("[data-task-link]")];
  const active = document.activeElement;
  const current = active === null ? -1 : tasks.indexOf(active);
  const end = direction === 1 ? 0 : tasks.length - 1;
  const index = current === -1 ? end : current + direction;
  const next = tasks[index];
  if (next instanceof HTMLElement) next.focus();
}

function isShortcut(event: KeyboardEvent): boolean {
  return !(
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    document.querySelector("dialog[open]") !== null
  );
}

function canMoveTaskFocus(target: EventTarget | null): boolean {
  return (
    target === document.body ||
    (target instanceof HTMLElement && target.matches("[data-task-link]"))
  );
}

export function useWorkspaceKeys(options: {
  search: () => void;
  closeTask: () => void;
  taskOpen: boolean;
}) {
  const { search, closeTask, taskOpen } = options;
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!isShortcut(event)) return;
      if (taskOpen && event.key === "Escape") {
        event.preventDefault();
        closeTask();
        return;
      }
      if (editing(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        search();
      } else if (
        !taskOpen &&
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        canMoveTaskFocus(event.target)
      ) {
        event.preventDefault();
        focusAdjacentTask(event.key === "ArrowDown" ? 1 : -1);
      }
    }
    globalThis.addEventListener("keydown", handleKey);
    return () => {
      globalThis.removeEventListener("keydown", handleKey);
    };
  }, [search, closeTask, taskOpen]);
}
