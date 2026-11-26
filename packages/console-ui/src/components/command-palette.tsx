import { Dialog } from "@base-ui/react/dialog";
import { CornerDownLeftIcon, SearchIcon, type LucideIcon } from "lucide-react";
import {
  useId,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { IconButton } from "@shepherdjerred/console-ui/components/icon-button.tsx";

export type CommandPaletteItem = {
  /** Unique across the whole palette. */
  readonly id: string;
  readonly label: string;
  /** Muted monospace text at the end of the row, e.g. a path or an id. */
  readonly detail?: string;
  readonly icon: LucideIcon;
};

export type CommandPaletteSection<
  Item extends CommandPaletteItem = CommandPaletteItem,
> = {
  readonly heading: string;
  readonly items: readonly Item[];
};

/** The key fields the shortcut reads, so tests can pass a plain object. */
export type CommandPaletteKeyEvent = Pick<
  globalThis.KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "preventDefault"
>;

/** Where the store listens for ⌘K; tests pass a fake. */
export type CommandPaletteKeyTarget = {
  addEventListener: (
    type: "keydown",
    listener: (event: CommandPaletteKeyEvent) => void,
  ) => void;
};

export type CommandPaletteStore = {
  readonly isOpen: () => boolean;
  readonly setOpen: (next: boolean) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** Whether the palette is open, as a React hook. */
  readonly useOpen: () => boolean;
};

/** Whether a key press is the palette's global shortcut, ⌘K or Ctrl+K. */
export function isCommandPaletteShortcut(
  event: Omit<CommandPaletteKeyEvent, "preventDefault">,
): boolean {
  return (
    event.key.toLowerCase() === "k" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

/**
 * Whether the palette is open, kept outside React. Creating the store binds
 * ⌘K and Ctrl+K on `keyTarget` (the document by default) to toggle it, so
 * the shortcut works from anywhere without an effect. Pass `null` to leave
 * the shortcut unbound. Create one store per app, at module scope.
 */
export function createCommandPaletteStore(
  keyTarget: CommandPaletteKeyTarget | null = globalThis.document,
): CommandPaletteStore {
  let open = false;
  const listeners = new Set<() => void>();
  const isOpen = (): boolean => open;
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    for (const listener of listeners) listener();
  }
  keyTarget?.addEventListener("keydown", (event) => {
    if (!isCommandPaletteShortcut(event)) return;
    event.preventDefault();
    setOpen(!open);
  });
  return {
    isOpen,
    setOpen,
    subscribe,
    useOpen: () => useSyncExternalStore(subscribe, isOpen, isOpen),
  };
}

export type CommandPaletteProps = {
  readonly store: CommandPaletteStore;
  /** Names the dialog and its search box, e.g. "Search and commands". */
  readonly label: string;
  /**
   * The body, usually a `CommandPaletteSearch`. It mounts with each opening,
   * so any state it holds starts fresh.
   */
  readonly children: ReactNode;
};

/** The modal ⌘K dialog: a backdrop and a centred panel near the top. */
export function CommandPalette({
  store,
  label,
  children,
}: CommandPaletteProps): React.JSX.Element {
  const open = store.useOpen();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        store.setOpen(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-palette-backdrop" />
        <Dialog.Popup className="ui-palette">
          <Dialog.Title className="ui-sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type CommandPaletteSearchProps<Item extends CommandPaletteItem> = {
  /** The palette's store; choosing an option closes it. */
  readonly store: CommandPaletteStore;
  /** Names the search box; match the palette's `label`. */
  readonly label: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** The results for `query`, in display and keyboard order. */
  readonly sections: readonly CommandPaletteSection<Item>[];
  /**
   * Runs once the palette has closed and returned focus, so a navigation
   * is not undone by the focus restore.
   */
  readonly onSelect: (item: Item) => void;
  readonly placeholder?: string;
  /**
   * Announced under the results, e.g. "Searching…". Without it, an empty
   * list reads "No results.".
   */
  readonly status?: string | undefined;
};

/**
 * The palette's search box and grouped results, inside a `CommandPalette`.
 * Arrow keys move the highlighted option, Enter chooses it, and the
 * highlight returns to the first option whenever the query changes.
 */
export function CommandPaletteSearch<Item extends CommandPaletteItem>({
  store,
  label,
  query,
  onQueryChange,
  sections,
  onSelect,
  placeholder,
  status,
}: CommandPaletteSearchProps<Item>): React.JSX.Element {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number): string =>
    `${baseId}-option-${String(index)}`;
  const [selected, setSelected] = useState(0);
  const items = sections.flatMap((section) => section.items);
  const active = Math.min(selected, items.length - 1);

  function choose(item: Item | undefined): void {
    if (item === undefined) return;
    store.setOpen(false);
    requestAnimationFrame(() => {
      onSelect(item);
    });
  }

  function move(step: 1 | -1): void {
    if (items.length === 0) return;
    const next = (active + step + items.length) % items.length;
    setSelected(next);
    document
      .querySelector(`#${CSS.escape(optionId(next))}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        move(1);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        move(-1);
        break;
      }
      case "Enter": {
        event.preventDefault();
        choose(items[active]);
        break;
      }
      default:
    }
  }

  // Each section's first option index in the flat, keyboard-ordered list.
  const starts = sections.map((_, sectionIndex) =>
    sections
      .slice(0, sectionIndex)
      .reduce((count, section) => count + section.items.length, 0),
  );
  return (
    <>
      <div className="ui-palette-search">
        <SearchIcon aria-hidden="true" />
        <input
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          {...(items.length === 0
            ? {}
            : { "aria-activedescendant": optionId(active) })}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="ui-palette-results" id={listboxId} role="listbox">
        {sections.map((section, sectionIndex) => (
          <div key={section.heading} role="group" aria-label={section.heading}>
            <p className="ui-palette-heading" aria-hidden="true">
              {section.heading}
            </p>
            {section.items.map((item, position) => {
              const itemIndex = (starts[sectionIndex] ?? 0) + position;
              return (
                <button
                  key={item.id}
                  id={optionId(itemIndex)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={itemIndex === active}
                  className="ui-palette-option"
                  onMouseMove={() => {
                    setSelected(itemIndex);
                  }}
                  onClick={() => {
                    choose(item);
                  }}
                >
                  <item.icon aria-hidden="true" />
                  <span className="ui-palette-label">{item.label}</span>
                  {item.detail === undefined ? null : (
                    <span className="ui-palette-detail">{item.detail}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <p className="ui-palette-status" role="status">
          {status ?? (items.length === 0 ? "No results." : "")}
        </p>
      </div>
      <div className="ui-palette-footer" aria-hidden="true">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>
            <CornerDownLeftIcon />
          </kbd>{" "}
          open
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </>
  );
}

export type CommandPaletteButtonProps = {
  readonly store: CommandPaletteStore;
  /** The button's accessible name; match the palette's `label`. */
  readonly label: string;
  /** Tooltip naming the shortcut. */
  readonly title?: string;
};

/** The sidebar's search icon button; it opens the palette. */
export function CommandPaletteButton({
  store,
  label,
  title = "Search (⌘K)",
}: CommandPaletteButtonProps): React.JSX.Element {
  return (
    <IconButton
      icon={SearchIcon}
      label={label}
      aria-keyshortcuts="Meta+K Control+K"
      title={title}
      onClick={() => {
        store.setOpen(true);
      }}
    />
  );
}
