import { useEffect, useRef } from "react";

export type Binding = {
  /** `KeyboardEvent.key`; letters compare case-insensitively. */
  readonly key: string;
  readonly run: (event: KeyboardEvent) => void;
};

/** True when typing, not commanding: a field, a select, or editable text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return (
    element !== null &&
    (element.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
  );
}

/** A control that already does something with Enter; the page must not steal the key. */
function isActivatable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a[href], button, summary, [role='button']") !== null
  );
}

/** The parts of a key event that decide whether a binding fires. */
export type KeyInput = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey"
>;

export function matches(binding: Binding, event: KeyInput): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return binding.key.length === 1
    ? event.key.toLowerCase() === binding.key.toLowerCase()
    : event.key === binding.key;
}

const stack: { current: readonly Binding[] }[] = [];

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const escape = event.key === "Escape";
  // Typing and open modals own the keyboard, except that Escape still reaches
  // the page when a field has focus (to leave comment mode).
  if (!escape && isTypingTarget(event.target)) return;
  if (event.key === "Enter" && isActivatable(event.target)) return;
  if (!escape && document.querySelector("dialog[open]") !== null) return;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    const binding = entry?.current.find((candidate) =>
      matches(candidate, event),
    );
    if (binding !== undefined) {
      event.preventDefault();
      binding.run(event);
      return;
    }
  }
}

let listening = false;

/**
 * Registers key bindings while the caller is mounted. The most recently
 * mounted binding for a key wins, so a page overrides the shell.
 */
export function useShortcuts(bindings: readonly Binding[]): void {
  const holder = useRef<{ current: readonly Binding[] }>({ current: bindings });
  holder.current.current = bindings;
  useEffect(() => {
    const entry = holder.current;
    stack.push(entry);
    if (!listening) {
      document.addEventListener("keydown", onKeyDown);
      listening = true;
    }
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (stack.length === 0) {
        document.removeEventListener("keydown", onKeyDown);
        listening = false;
      }
    };
  }, []);
}

export const SHORTCUT_SHEET: readonly {
  readonly keys: string;
  readonly does: string;
}[] = [
  { keys: "C", does: "Comment mode: click to place a pin" },
  { keys: "Enter", does: "Interact with the selected frame" },
  { keys: "Esc", does: "Leave the frame, comment mode, or a draft" },
  { keys: "F", does: "Open the selected frame full size" },
  { keys: "J / K", does: "Next and previous thread" },
  { keys: "R", does: "Reply to the selected thread" },
  { keys: "E", does: "Resolve or reopen the selected thread" },
  { keys: "[ / ]", does: "Previous and next version" },
  { keys: "?", does: "This sheet" },
];
