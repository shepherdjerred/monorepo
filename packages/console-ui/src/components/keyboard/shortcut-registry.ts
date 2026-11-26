import { useSyncExternalStore } from "react";
import {
  isEditableTarget,
  isTextField,
} from "@shepherdjerred/console-ui/components/feedback/use-search-shortcut.ts";
import {
  ariaKeyshortcuts,
  bindingId,
  formatShortcut,
  isApplePlatform,
  matchesChord,
  parseShortcut,
  type ShortcutBinding,
  type ShortcutKeyPress,
} from "@shepherdjerred/console-ui/components/keyboard/shortcut-keys.ts";

export type Shortcut = {
  /** Unique in the registry; menus look a hint up by it. */
  readonly id: string;
  /** `"c"`, `"?"`, `"g i"`, `"Mod+K"`: see `parseShortcut`. */
  readonly keys: string;
  /** Sentence case, as the help sheet lists it. */
  readonly description: string;
  /** The help sheet's heading for it, e.g. "Navigation". */
  readonly group: string;
  /**
   * Runs on the key press. Return `false` when it did nothing, so the
   * browser keeps the key. Omit it to list a shortcut that a dialog or
   * editor handles itself.
   */
  readonly run?: (event: ShortcutEvent) => unknown;
  /** Also while typing in a field or with a dialog open. */
  readonly anywhere?: boolean;
  /** Only while `activateScope(scope)` holds, e.g. on one page. */
  readonly scope?: string;
  /**
   * How the help sheet lists it, when one line stands for a family
   * (`G 1–9`); `false` leaves it to the line that does.
   */
  readonly sheet?:
    false | { readonly keys: string; readonly description: string };
};

export type ShortcutEvent = ShortcutKeyPress & {
  readonly target: EventTarget | null;
  readonly defaultPrevented: boolean;
  readonly isComposing?: boolean;
  readonly preventDefault: () => void;
};

/** Where the registry listens; tests pass a fake or `null`. */
export type ShortcutKeyTarget = {
  addEventListener: (
    type: "keydown",
    listener: (event: ShortcutEvent) => void,
  ) => void;
  removeEventListener: (
    type: "keydown",
    listener: (event: ShortcutEvent) => void,
  ) => void;
};

export type ShortcutSheetGroup = {
  readonly group: string;
  readonly shortcuts: readonly {
    readonly id: string;
    readonly keys: string;
    readonly description: string;
  }[];
};

export type ShortcutRegistryOptions = {
  /** Where keydown is read; the document by default, `null` for none. */
  readonly target?: ShortcutKeyTarget | null;
  /** How long the first key of a sequence waits for the next, in ms. */
  readonly sequenceTimeout?: number;
  /** Help-sheet group order; unknown groups follow in first-seen order. */
  readonly groups?: readonly string[];
  /**
   * Whether an overlay owns the keyboard. By default an open dialog does
   * (a Base UI dialog, popover or sheet, or a native modal).
   */
  readonly isBlocked?: () => boolean;
  /** ⌘ or Ctrl in the hints; detected from the user agent by default. */
  readonly apple?: boolean;
  readonly now?: () => number;
};

export type ShortcutRegistry = {
  /** Adds shortcuts; returns a function that removes them again. */
  readonly register: (shortcuts: Shortcut | readonly Shortcut[]) => () => void;
  /** Turns on the shortcuts of one scope until the returned function runs. */
  readonly activateScope: (scope: string) => () => void;
  /** Handles one key press; returns whether a shortcut ran. */
  readonly handleKeyDown: (event: ShortcutEvent) => boolean;
  /** The shortcuts that are registered and in an active scope. */
  readonly active: () => readonly Shortcut[];
  /** What the help sheet lists, grouped and ordered. */
  readonly sheet: () => readonly ShortcutSheetGroup[];
  readonly subscribe: (listener: () => void) => () => void;
  /** The help sheet's groups as a React hook. */
  readonly useSheet: () => readonly ShortcutSheetGroup[];
  /** The keycaps for a registered shortcut, e.g. for a menu hint. */
  readonly hint: (id: string) => readonly string[] | undefined;
  /** `aria-keyshortcuts` for a registered shortcut. */
  readonly aria: (id: string) => string | undefined;
  /** Stops listening. */
  readonly destroy: () => void;
};

type Entry = { readonly shortcut: Shortcut; readonly binding: ShortcutBinding };

/** An open, interactive dialog owns the keyboard; one fading out is inert. */
function dialogOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(
      '[role="dialog"]:not([inert]), [role="alertdialog"]:not([inert]), dialog:modal',
    ) !== null
  );
}

/** Enter already activates these; the shortcut must not take it from them. */
const ACTIVATABLE =
  'a[href], button, summary, [role="button"], [role="option"], [role="menuitem"]';

function takesEnter(event: ShortcutEvent): boolean {
  return (
    event.key === "Enter" &&
    typeof Element !== "undefined" &&
    event.target instanceof Element &&
    event.target.closest(ACTIVATABLE) !== null
  );
}

function orderGroups(
  entries: readonly Entry[],
  order: readonly string[],
): ShortcutSheetGroup[] {
  const groups = new Map<string, ShortcutSheetGroup["shortcuts"][number][]>();
  for (const name of order) groups.set(name, []);
  for (const { shortcut } of entries) {
    if (shortcut.sheet === false) continue;
    const listed = shortcut.sheet ?? shortcut;
    const rows = groups.get(shortcut.group) ?? [];
    rows.push({
      id: shortcut.id,
      keys: listed.keys,
      description: listed.description,
    });
    groups.set(shortcut.group, rows);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 0)
    .map(([group, shortcuts]) => ({ group, shortcuts }));
}

/**
 * The app's keyboard shortcuts in one list: the key handler and the help
 * sheet both read it, so what the sheet says is what the keys do. Plain keys
 * are ignored while focus is in a field, select, menu or listbox, while a
 * dialog is open, and Enter on a button or link; chords are ignored in text
 * fields and dialogs. `anywhere` lifts both. The first key of a sequence
 * wins over a one-key shortcut with the same key. Create one registry per
 * app, at module scope; creating it listens on the document.
 */
export function createShortcutRegistry(
  options: ShortcutRegistryOptions = {},
): ShortcutRegistry {
  const target: ShortcutKeyTarget | null =
    options.target === undefined
      ? typeof document === "undefined"
        ? null
        : document
      : options.target;
  const {
    sequenceTimeout = 900,
    groups: groupOrder = [],
    isBlocked = dialogOpen,
    apple = isApplePlatform(),
    now = () => performance.now(),
  } = options;
  const entries: Entry[] = [];
  const scopes = new Map<string, number>();
  const listeners = new Set<() => void>();
  let pending: { keys: readonly string[]; until: number } | undefined;
  let sheetCache: readonly ShortcutSheetGroup[] | undefined;

  const inScope = ({ shortcut }: Entry): boolean =>
    shortcut.scope === undefined || (scopes.get(shortcut.scope) ?? 0) > 0;
  const activeEntries = (): Entry[] =>
    entries.filter((entry) => inScope(entry));
  function changed(): void {
    sheetCache = undefined;
    for (const listener of listeners) listener();
  }

  function register(input: Shortcut | readonly Shortcut[]): () => void {
    const added: Entry[] = (Array.isArray(input) ? input : [input]).map(
      (shortcut: Shortcut) => ({
        shortcut,
        binding: parseShortcut(shortcut.keys),
      }),
    );
    for (const entry of added) {
      const clash = [...entries, ...added].find(
        (other) =>
          other !== entry &&
          (other.shortcut.id === entry.shortcut.id ||
            (other.shortcut.scope === entry.shortcut.scope &&
              bindingId(other.binding) === bindingId(entry.binding))),
      );
      if (clash !== undefined) {
        throw new Error(
          `Shortcut "${entry.shortcut.id}" (${entry.shortcut.keys}) clashes with "${clash.shortcut.id}" (${clash.shortcut.keys}).`,
        );
      }
    }
    entries.push(...added);
    changed();
    return () => {
      for (const entry of added) {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      }
      changed();
    };
  }

  function activateScope(scope: string): () => void {
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
    changed();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      scopes.set(scope, (scopes.get(scope) ?? 1) - 1);
      changed();
    };
  }

  function run(
    entry: Entry | undefined,
    event: ShortcutEvent,
    allowed: boolean,
  ): boolean {
    if (entry?.shortcut.run === undefined) return false;
    if (!(allowed || entry.shortcut.anywhere === true)) return false;
    if (entry.shortcut.run(event) === false) return false;
    event.preventDefault();
    return true;
  }

  function handleKeyDown(event: ShortcutEvent): boolean {
    if (event.defaultPrevented || event.isComposing === true) return false;
    const live = activeEntries();
    const waiting =
      pending !== undefined && pending.until > now() ? pending.keys : [];
    pending = undefined;
    if (event.metaKey || event.ctrlKey || event.altKey) {
      const chord = live.find(
        ({ binding }) =>
          binding.kind === "chord" && matchesChord(binding, event),
      );
      return run(chord, event, !isTextField(event.target) && !isBlocked());
    }
    const plainAllowed =
      !isBlocked() && !isEditableTarget(event.target) && !takesEnter(event);
    const typed = [...waiting, event.key];
    const sequences = live.flatMap((entry) =>
      entry.binding.kind === "sequence"
        ? [{ entry, keys: entry.binding.keys }]
        : [],
    );
    const complete = sequences.find(
      ({ keys }) => keys.join(" ") === typed.join(" "),
    )?.entry;
    if (complete !== undefined && waiting.length > 0) {
      return run(complete, event, plainAllowed);
    }
    const starts = (prefix: readonly string[]): boolean =>
      sequences.some(
        ({ keys }) =>
          keys.length > prefix.length &&
          prefix.every((key, index) => keys[index] === key),
      );
    const prefix = waiting.length > 0 && starts(typed) ? typed : [event.key];
    if (plainAllowed && starts(prefix)) {
      pending = { keys: prefix, until: now() + sequenceTimeout };
      return false;
    }
    const single = live.find(
      ({ binding }) => binding.kind === "key" && binding.key === event.key,
    );
    return run(single, event, plainAllowed);
  }

  const listener = (event: ShortcutEvent): void => {
    handleKeyDown(event);
  };
  target?.addEventListener("keydown", listener);

  const sheet = (): readonly ShortcutSheetGroup[] => {
    sheetCache ??= orderGroups(activeEntries(), groupOrder);
    return sheetCache;
  };
  const subscribe = (next: () => void): (() => void) => {
    listeners.add(next);
    return () => listeners.delete(next);
  };
  const find = (id: string): Shortcut | undefined =>
    activeEntries().find(({ shortcut }) => shortcut.id === id)?.shortcut;

  return {
    register,
    activateScope,
    handleKeyDown,
    active: () => activeEntries().map(({ shortcut }) => shortcut),
    sheet,
    subscribe,
    useSheet: () => useSyncExternalStore(subscribe, sheet, sheet),
    hint: (id) => {
      const shortcut = find(id);
      return shortcut === undefined
        ? undefined
        : formatShortcut(shortcut.keys, apple);
    },
    aria: (id) => {
      const shortcut = find(id);
      return shortcut === undefined
        ? undefined
        : ariaKeyshortcuts(shortcut.keys);
    },
    destroy: () => {
      target?.removeEventListener("keydown", listener);
    },
  };
}
