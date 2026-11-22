import { useCallback } from "react";

/**
 * A ref for the root of a button and the panel it discloses. While the panel
 * is open, the document is watched for the ways out of it: Escape closes it
 * and returns focus to the button, which is the root's first; a press or
 * focus anywhere outside the root closes it.
 *
 * React runs the ref again, and its cleanup, each time `open` changes, so
 * nothing listens while the panel is closed.
 */
export function useDismissal(open: boolean, setOpen: (open: boolean) => void) {
  return useCallback(
    (root: HTMLDivElement | null) => {
      if (root === null || !open) return;
      const outside = (target: EventTarget | null) =>
        target instanceof Node && !root.contains(target);
      const onPress = (event: PointerEvent) => {
        if (outside(event.target)) setOpen(false);
      };
      const onFocus = (event: FocusEvent) => {
        if (outside(event.target)) setOpen(false);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        setOpen(false);
        root.querySelector("button")?.focus();
      };
      document.addEventListener("pointerdown", onPress);
      document.addEventListener("focusin", onFocus);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onPress);
        document.removeEventListener("focusin", onFocus);
        document.removeEventListener("keydown", onKey);
      };
    },
    [open, setOpen],
  );
}
