import { useCallback, useRef, type RefCallback } from "react";

/**
 * The key `delta` rows away from `current`, clamped to the list. With no
 * current row, moving down starts at the first row and moving up at the last.
 */
export function nextRowKey(
  keys: readonly string[],
  current: string | undefined,
  delta: number,
): string | undefined {
  if (keys.length === 0) {
    return undefined;
  }
  const index = current === undefined ? -1 : keys.indexOf(current);
  if (index === -1) {
    return delta > 0 ? keys[0] : keys.at(-1);
  }
  return keys[Math.min(Math.max(index + delta, 0), keys.length - 1)];
}

/** True while the user is typing, when single-letter shortcuts must stay quiet. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [role='combobox']") !== null)
  );
}

export type RowNavigationOptions = {
  /** Row keys in display order. */
  readonly keys: readonly string[];
  readonly current: string | undefined;
  readonly onChange: (key: string) => void;
  /** Enter or `o` on the current row, when focus is not on a control. */
  readonly onOpen?: ((key: string) => void) | undefined;
  readonly enabled?: boolean | undefined;
};

const STEP: Readonly<Record<string, number>> = { j: 1, k: -1 };

function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("a, button") !== null;
}

type Latest = Omit<RowNavigationOptions, "enabled">;

function handleKey(event: KeyboardEvent, state: Latest): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey) {
    return;
  }
  if (event.metaKey || isTypingTarget(event.target)) {
    return;
  }
  const step = STEP[event.key];
  if (step !== undefined) {
    const next = nextRowKey(state.keys, state.current, step);
    if (next !== undefined) {
      event.preventDefault();
      state.onChange(next);
    }
    return;
  }
  const opens = event.key === "o" || event.key === "Enter";
  if (!opens || state.onOpen === undefined || state.current === undefined) {
    return;
  }
  // Enter on a focused button or link is that control's own action.
  if (event.key === "Enter" && isControl(event.target)) {
    return;
  }
  event.preventDefault();
  state.onOpen(state.current);
}

/**
 * j and k move the current row down and up across the whole page, the way
 * the consoles' lists do; Enter or `o` opens it. Keys typed into a field, or
 * pressed with a modifier, are left alone. Put the returned ref on the
 * list's element: the keys work while it is mounted.
 */
export function useRowNavigation({
  keys,
  current,
  onChange,
  onOpen,
  enabled = true,
}: RowNavigationOptions): RefCallback<HTMLElement> {
  const latest = useRef<Latest>({ keys, current, onChange, onOpen });
  latest.current = { keys, current, onChange, onOpen };
  return useCallback(
    (element: HTMLElement | null) => {
      if (element === null || !enabled) {
        return;
      }
      const target = element.ownerDocument;
      const onKeyDown = (event: KeyboardEvent): void => {
        handleKey(event, latest.current);
      };
      target.addEventListener("keydown", onKeyDown);
      return () => {
        target.removeEventListener("keydown", onKeyDown);
      };
    },
    [enabled],
  );
}
