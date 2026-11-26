import { Dialog } from "@base-ui/react/dialog";
import { CheckIcon, CornerDownLeftIcon, type LucideIcon } from "lucide-react";
import {
  createContext,
  use,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { IconButton } from "@shepherdjerred/console-ui/components/icon-button.tsx";
import { KeyHint } from "@shepherdjerred/console-ui/components/keyboard/key-hint.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

const SearchIcon = ICONS.search;
const BackIcon = ICONS.back;

export type CommandPaletteItem = {
  /** Unique across the whole palette. */
  readonly id: string;
  readonly label: string;
  /** Muted monospace text at the end of the row, e.g. a path or an id. */
  readonly detail?: string;
  readonly icon: LucideIcon;
  /** Shows a check: the option is the current value. */
  readonly checked?: boolean;
  /** The keys that run the same command elsewhere, e.g. `"g i"`. */
  readonly hint?: string;
};

/**
 * Lets the search inside a palette take Escape for "back" while a step is
 * open, instead of closing the palette.
 */
const PaletteBackContext = createContext<{
  current: (() => boolean) | null;
} | null>(null);

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
  const back = useRef<(() => boolean) | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        // Inside a step, Escape goes back a step instead of closing.
        if (
          !next &&
          details.reason === "escape-key" &&
          back.current?.() === true
        ) {
          details.cancel();
          return;
        }
        store.setOpen(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-palette-backdrop" />
        <Dialog.Popup className="ui-palette">
          <Dialog.Title className="ui-sr-only">{label}</Dialog.Title>
          <PaletteBackContext value={back}>{children}</PaletteBackContext>
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
  readonly placeholder?: string | undefined;
  /**
   * Announced under the results, e.g. "Searching…". Without it, an empty
   * list reads "No results.".
   */
  readonly status?: string | undefined;
  /**
   * The steps taken into nested lists, shown before the input. With
   * `onBack`, Backspace in an empty input, Escape and the back button
   * leave the last step.
   */
  readonly breadcrumb?: readonly string[];
  readonly onBack?: () => void;
  /**
   * Items for which this returns true are chosen without closing the
   * palette: `onSelect` runs at once, e.g. to step into a list.
   */
  readonly keepOpen?: (item: Item) => boolean;
  /** Changing it puts the highlight back on the first option, e.g. per step. */
  readonly listKey?: string;
};

/** The back button and the step titles, before the input. */
function PaletteCrumbs({
  breadcrumb,
  onBack,
}: {
  readonly breadcrumb: readonly string[];
  readonly onBack: (() => void) | undefined;
}): React.JSX.Element | null {
  if (breadcrumb.length === 0) return null;
  return (
    <>
      {onBack === undefined ? null : (
        <IconButton icon={BackIcon} label="Back" onClick={onBack} />
      )}
      <span className="ui-palette-crumbs">
        {breadcrumb.map((crumb, index) => (
          // A step's place in the trail is its identity.
          <span key={`${String(index)}-${crumb}`} className="ui-palette-crumb">
            {crumb}
          </span>
        ))}
      </span>
    </>
  );
}

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
  breadcrumb = [],
  onBack,
  keepOpen,
  listKey = "",
}: CommandPaletteSearchProps<Item>): React.JSX.Element {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number): string =>
    `${baseId}-option-${String(index)}`;
  const [highlight, setHighlight] = useState({ key: listKey, index: 0 });
  const selected = highlight.key === listKey ? highlight.index : 0;
  const setSelected = (index: number): void => {
    setHighlight({ key: listKey, index });
  };
  const back = use(PaletteBackContext);
  const items = sections.flatMap((section) => section.items);
  const active = Math.min(selected, items.length - 1);

  function choose(item: Item | undefined): void {
    if (item === undefined) return;
    if (keepOpen?.(item) === true) {
      onSelect(item);
      return;
    }
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
        if (event.nativeEvent.isComposing) break;
        event.preventDefault();
        choose(items[active]);
        break;
      }
      case "Backspace": {
        if (query !== "" || onBack === undefined || breadcrumb.length === 0) {
          break;
        }
        event.preventDefault();
        onBack();
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
        {breadcrumb.length === 0 ? <SearchIcon aria-hidden="true" /> : null}
        <PaletteCrumbs breadcrumb={breadcrumb} onBack={onBack} />
        <input
          ref={(input) => {
            if (input === null || back === null) return;
            back.current =
              onBack === undefined || breadcrumb.length === 0
                ? null
                : () => {
                    onBack();
                    return true;
                  };
            return () => {
              back.current = null;
            };
          }}
          role="combobox"
          aria-label={
            breadcrumb.length === 0
              ? label
              : `${label}: ${breadcrumb.join(", ")}`
          }
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
                  {item.hint === undefined ? null : (
                    <KeyHint keys={item.hint} decorative />
                  )}
                  {item.checked === true ? (
                    <CheckIcon
                      className="ui-palette-check"
                      aria-label="Current"
                    />
                  ) : null}
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
          {breadcrumb.length === 0 ? "open" : "choose"}
        </span>
        <span>
          <kbd>Esc</kbd> {breadcrumb.length === 0 ? "close" : "back"}
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
