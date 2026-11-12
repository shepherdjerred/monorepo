import { useCallback, useRef } from "react";

/**
 * How a shortcut is typed. A `key` is matched against `KeyboardEvent.key`
 * (so "P" is Shift+P), a `sequence` is two keys in a row, and a `chord` is
 * Cmd on macOS or Ctrl elsewhere with a physical key, matched by `code` so
 * Shift does not change which key it is.
 */
export type Binding =
  | { type: "key"; key: string }
  | { type: "sequence"; keys: readonly [string, string] }
  | { type: "chord"; code: string; shift: boolean };

export type ShortcutGroup =
  "General" | "Navigation" | "Issue" | "Selection" | "Editor";

export type Shortcut = {
  /** The shell action it runs; its name is also its palette hint lookup. */
  action: string;
  binding: Binding;
  /** How the help sheet and palette show it. */
  keys: string;
  description: string;
  group: ShortcutGroup;
  /** Also while typing in a field. */
  anywhere?: boolean;
  /** Listed for reference; the dialog or editor it belongs to handles it. */
  local?: boolean;
};

const key = (value: string): Binding => ({ type: "key", key: value });
const sequence = (first: string, second: string): Binding => ({
  type: "sequence",
  keys: [first, second],
});
const chord = (code: string, shift = false): Binding => ({
  type: "chord",
  code,
  shift,
});

/**
 * Every keyboard shortcut. The handler and the help sheet both read this
 * list, so what the sheet says is what the keys do. Only the chords listed
 * here are taken from the browser; copy, paste, select-all in a field and
 * browser navigation are left alone.
 */
export const shortcuts: readonly Shortcut[] = [
  {
    action: "palette",
    binding: chord("KeyK"),
    keys: "⌘ K",
    description: "Search and commands",
    group: "General",
    anywhere: true,
  },
  {
    action: "c",
    binding: key("c"),
    keys: "C",
    description: "Create issue",
    group: "General",
  },
  {
    action: "C",
    binding: key("C"),
    keys: "⇧ C",
    description: "Create issue in this view, filled in from it",
    group: "General",
  },
  {
    action: "/",
    binding: key("/"),
    keys: "/",
    description: "Search issues",
    group: "General",
  },
  {
    action: "f",
    binding: key("f"),
    keys: "F",
    description: "Filter issues",
    group: "General",
  },
  {
    action: "undo",
    binding: chord("KeyZ"),
    keys: "⌘ Z",
    description: "Undo the last change",
    group: "General",
  },
  {
    action: "Escape",
    binding: key("Escape"),
    keys: "Esc",
    description: "Close overlay, clear selection or go back",
    group: "General",
  },
  {
    action: "?",
    binding: key("?"),
    keys: "?",
    description: "Keyboard shortcuts",
    group: "General",
  },
  {
    action: "j",
    binding: key("j"),
    keys: "J",
    description: "Next issue",
    group: "Navigation",
  },
  {
    action: "k",
    binding: key("k"),
    keys: "K",
    description: "Previous issue",
    group: "Navigation",
  },
  {
    action: "Enter",
    binding: key("Enter"),
    keys: "Enter",
    description: "Open focused issue",
    group: "Navigation",
  },
  {
    action: "[",
    binding: key("["),
    keys: "[",
    description: "Previous issue while one is open",
    group: "Navigation",
  },
  {
    action: "]",
    binding: key("]"),
    keys: "]",
    description: "Next issue while one is open",
    group: "Navigation",
  },
  {
    action: "gi",
    binding: sequence("g", "i"),
    keys: "G I",
    description: "Go to issues",
    group: "Navigation",
  },
  {
    action: "gb",
    binding: sequence("g", "b"),
    keys: "G B",
    description: "Go to board",
    group: "Navigation",
  },
  {
    action: "gp",
    binding: sequence("g", "p"),
    keys: "G P",
    description: "Go to projects",
    group: "Navigation",
  },
  {
    action: "ga",
    binding: sequence("g", "a"),
    keys: "G A",
    description: "Go to activity",
    group: "Navigation",
  },
  {
    action: "gm",
    binding: sequence("g", "m"),
    keys: "G M",
    description: "Go to my issues",
    group: "Navigation",
  },
  {
    action: "s",
    binding: key("s"),
    keys: "S",
    description: "Set status",
    group: "Issue",
  },
  {
    action: "p",
    binding: key("p"),
    keys: "P",
    description: "Set priority",
    group: "Issue",
  },
  {
    action: "a",
    binding: key("a"),
    keys: "A",
    description: "Set assignee",
    group: "Issue",
  },
  {
    action: "i",
    binding: key("i"),
    keys: "I",
    description: "Assign to me",
    group: "Issue",
  },
  {
    action: "l",
    binding: key("l"),
    keys: "L",
    description: "Set labels",
    group: "Issue",
  },
  {
    action: "P",
    binding: key("P"),
    keys: "⇧ P",
    description: "Set project",
    group: "Issue",
  },
  {
    action: "v",
    binding: key("v"),
    keys: "V",
    description: "Vote",
    group: "Issue",
  },
  {
    action: "e",
    binding: key("e"),
    keys: "E",
    description: "Edit description",
    group: "Issue",
  },
  {
    action: "copyId",
    binding: chord("Period"),
    keys: "⌘ .",
    description: "Copy issue ID",
    group: "Issue",
  },
  {
    action: "copyLink",
    binding: chord("Comma", true),
    keys: "⌘ ⇧ ,",
    description: "Copy issue link",
    group: "Issue",
  },
  {
    action: "x",
    binding: key("x"),
    keys: "X",
    description: "Select focused issue",
    group: "Selection",
  },
  {
    action: "J",
    binding: key("J"),
    keys: "⇧ J",
    description: "Extend selection down",
    group: "Selection",
  },
  {
    action: "K",
    binding: key("K"),
    keys: "⇧ K",
    description: "Extend selection up",
    group: "Selection",
  },
  {
    action: "selectAll",
    binding: chord("KeyA"),
    keys: "⌘ A",
    description: "Select every loaded issue (in the list)",
    group: "Selection",
  },
  {
    action: "submit",
    binding: chord("Enter"),
    keys: "⌘ Enter",
    description: "Create issue, send comment or save",
    group: "Editor",
    local: true,
  },
  {
    action: "submitAndOpen",
    binding: chord("Enter", true),
    keys: "⌘ ⇧ Enter",
    description: "Create issue and open it",
    group: "Editor",
    local: true,
  },
];

export const shortcutGroups: readonly ShortcutGroup[] = [
  "General",
  "Navigation",
  "Issue",
  "Selection",
  "Editor",
];

/** The keys shown beside a command that has a shortcut. */
export function shortcutKeys(action: string) {
  return shortcuts.find((shortcut) => shortcut.action === action)?.keys;
}

const codeKeys: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Enter: "Enter",
};

/**
 * The shortcut in `aria-keyshortcuts` form, which a screen reader announces
 * in place of the visible hint. Two-key sequences have no such form.
 */
export function ariaShortcut(action: string) {
  const binding = shortcuts.find(
    (shortcut) => shortcut.action === action,
  )?.binding;
  if (binding === undefined || binding.type === "sequence") {
    return;
  }
  if (binding.type === "key") {
    return /^[A-Z]$/u.test(binding.key) ? `Shift+${binding.key}` : binding.key;
  }
  const name = codeKeys[binding.code] ?? binding.code.replace(/^Key/u, "");
  return `Meta+${binding.shift ? "Shift+" : ""}${name}`;
}

/** Two shortcuts with one binding would make one of them unreachable. */
export function bindingId(binding: Binding) {
  switch (binding.type) {
    case "key": {
      return `key:${binding.key}`;
    }
    case "sequence": {
      return `sequence:${binding.keys.join(" ")}`;
    }
    case "chord": {
      return `chord:${binding.shift ? "shift+" : ""}${binding.code}`;
    }
  }
}

type KeyPress = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

const sequenceStarts = new Set(
  shortcuts.flatMap(({ binding }) =>
    binding.type === "sequence" ? [binding.keys[0]] : [],
  ),
);

/**
 * The shortcut a key press means, given the first key of a sequence typed
 * just before it. `start` says the press begins a sequence instead.
 */
export function resolveShortcut(
  press: KeyPress,
  pending: string | undefined,
): { shortcut?: Shortcut; start?: string } {
  if (press.altKey) {
    return {};
  }
  if (press.metaKey || press.ctrlKey) {
    const shortcut = shortcuts.find(
      ({ binding }) =>
        binding.type === "chord" &&
        binding.code === press.code &&
        binding.shift === press.shiftKey,
    );
    return shortcut === undefined ? {} : { shortcut };
  }
  if (pending !== undefined) {
    const shortcut = shortcuts.find(
      ({ binding }) =>
        binding.type === "sequence" &&
        binding.keys[0] === pending &&
        binding.keys[1] === press.key,
    );
    if (shortcut !== undefined) {
      return { shortcut };
    }
  }
  if (sequenceStarts.has(press.key)) {
    return { start: press.key };
  }
  const shortcut = shortcuts.find(
    ({ binding }) => binding.type === "key" && binding.key === press.key,
  );
  return shortcut === undefined ? {} : { shortcut };
}

// Text fields keep their own undo, copy and select-all.
const textField =
  "input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]";
// Plain keys also type ahead in a select; a row's own pickers and
// checkbox are part of the row.
const editable = `${textField}, select:not([data-picker])`;
// Enter already activates these; the shortcut must not take it from them.
const activatable =
  "a[href], button, summary, select, [role=button], [role=option]";
// Focus inside an open menu, listbox or picker belongs to it.
const popup = '[role="menu"], [role="listbox"], option';
const rowLink = "a[data-issue-row]";
const rowArrows: Record<string, string> = { ArrowDown: "j", ArrowUp: "k" };

const targetOf = (event: KeyboardEvent) =>
  event.target instanceof Element ? event.target : null;
/** A text field keeps its own undo history and its own chords. */
const inField = (event: KeyboardEvent) =>
  targetOf(event)?.closest(textField) != null;

/** On a row, the arrow keys step through the list as J and K do. */
function arrowsAsRows(event: KeyboardEvent): KeyPress {
  const mapped = rowArrows[event.key];
  return {
    key:
      mapped !== undefined && targetOf(event)?.closest(rowLink) != null
        ? mapped
        : event.key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}

/** True when plain keys belong to whatever has focus, not to the app. */
function plainKeyTaken(event: KeyboardEvent, blocked: boolean) {
  const target = targetOf(event);
  return (
    blocked ||
    target?.closest(editable) != null ||
    target?.closest(popup) != null ||
    document.querySelector('[role="dialog"]:not(.peek)') !== null ||
    (event.key === "Enter" && target?.closest(activatable) != null)
  );
}

/**
 * Keyboard shortcuts for the whole app, as `shortcuts` lists them. `action`
 * reports whether the key did something; only then is the browser's own
 * handling suppressed.
 */
export function useShortcuts(
  action: (name: string) => boolean,
  modalOpen: boolean,
) {
  const pending = useRef<{ key: string; until: number }>(undefined);
  const current = useRef({ action, modalOpen });
  current.current = { action, modalOpen };
  return useCallback((element: HTMLDivElement | null) => {
    if (element === null) {
      return;
    }
    function keydown(event: KeyboardEvent) {
      const { action: handle, modalOpen: blocked } = current.current;
      const modified = event.metaKey || event.ctrlKey;
      const waiting =
        pending.current !== undefined &&
        pending.current.until > performance.now()
          ? pending.current.key
          : undefined;
      const press = arrowsAsRows(event);
      const { shortcut, start } = resolveShortcut(press, waiting);
      pending.current = undefined;
      if (start !== undefined && !plainKeyTaken(event, blocked)) {
        pending.current = { key: start, until: performance.now() + 900 };
        return;
      }
      if (shortcut === undefined || shortcut.local === true) {
        return;
      }
      const allowed =
        shortcut.anywhere === true ||
        (modified
          ? !inField(event) && !blocked
          : !plainKeyTaken(event, blocked));
      if (allowed && handle(shortcut.action)) {
        event.preventDefault();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
    };
  }, []);
}
