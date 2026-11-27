import { useEffect } from "react";
import { isTypingTarget, useShortcuts } from "#client/shell/shortcuts.ts";
import type { Arrange } from "./use-arrange.ts";

/**
 * The keyboard half of arranging: arrows nudge the selection by 1 px (Shift
 * 10), `[` and `]` step it back and forward in z-order (`{` and `}` to the
 * ends), Delete asks to remove it from the board, and Mod+Z and Shift+Mod+Z
 * undo and redo.
 */
export function useArrangeKeys({
  arrange,
  onDelete,
}: {
  readonly arrange: Arrange;
  /** Asks the reviewer to confirm removing the selection. */
  readonly onDelete: () => void;
}): void {
  const { nudge, order, undo, redo } = arrange;
  const arrow = (dx: number, dy: number) => (event: KeyboardEvent) => {
    nudge(dx, dy, event.shiftKey);
  };
  useShortcuts([
    { key: "ArrowLeft", run: arrow(-1, 0) },
    { key: "ArrowRight", run: arrow(1, 0) },
    { key: "ArrowUp", run: arrow(0, -1) },
    { key: "ArrowDown", run: arrow(0, 1) },
    {
      key: "[",
      run: () => {
        order("backward");
      },
    },
    {
      key: "]",
      run: () => {
        order("forward");
      },
    },
    {
      key: "{",
      run: () => {
        order("back");
      },
    },
    {
      key: "}",
      run: () => {
        order("front");
      },
    },
    { key: "Delete", run: onDelete },
    { key: "Backspace", run: onDelete },
  ]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "z" || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.isComposing) return;
      // In a text field Mod+Z is the field's own undo.
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("dialog[open]") !== null) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [undo, redo]);
}
