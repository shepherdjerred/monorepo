import { useEffect, useId, useState } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "#src/components/ui/popover.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { cn } from "#src/lib/cn.ts";

/**
 * Generic controlled combobox: a text input that opens a popover of results.
 * The input text is controlled by the caller (so it can drive a debounced
 * search query); selecting a result invokes `onSelect`. Rendering of results
 * and the search itself live in the caller — this component is purely the
 * input + popover shell.
 *
 * Implements the ARIA combobox + listbox pattern: the input owns
 * `aria-activedescendant`, the `<ul>` is the `role="listbox"` referenced by
 * `aria-controls`, and each result is a `role="option"`. Keyboard navigation
 * (arrows / Enter / Escape) moves a virtual active option without moving DOM
 * focus out of the input. Home/End are intentionally left to the input so the
 * caret can jump to the start/end of a long value being edited.
 */
export function Combobox<T>(props: {
  value: string;
  onValueChange: (value: string) => void;
  items: T[];
  isLoading: boolean;
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  id?: string | undefined;
  // When true, the popover may open before the user types (e.g. to show a
  // pinned/default list on focus). Defaults to false so existing consumers keep
  // the "only open once there's a query" behavior.
  openOnEmptyQuery?: boolean | undefined;
  // Fired when the input loses focus — lets a consumer reconcile uncommitted
  // free text (e.g. revert to the committed value) once editing ends.
  onBlur?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const hasQuery = props.value.trim().length > 0;
  const canOpenWithoutQuery = props.openOnEmptyQuery ?? false;
  // Only show the popover while searching or when there are results — never an
  // empty "no results" box.
  const showPopover =
    open &&
    (hasQuery || canOpenWithoutQuery) &&
    (props.isLoading || props.items.length > 0);

  const optionId = (item: T) =>
    `${listId}-opt-${encodeURIComponent(props.getKey(item))}`;

  // A stable-enough signature of the rendered options: when the result set
  // changes we re-anchor the active option to the top, but plain re-renders
  // (e.g. during arrow navigation, where `items` keeps the same contents)
  // leave the user's position untouched.
  const itemCount = props.items.length;
  const itemsSignature = props.items
    .map((item) => props.getKey(item))
    .join(" ");
  useEffect(() => {
    // Open with items -> highlight the first; closed or loading -> nothing.
    setActiveIndex(showPopover && itemCount > 0 ? 0 : -1);
  }, [showPopover, itemCount, itemsSignature]);

  // While a new search is loading, `items` may still hold the previous
  // response (keepPreviousData). Do not resolve a committable active option in
  // that state: the visible highlight (aria-selected below) can stay put, but
  // Enter must not commit a stale result from the prior search.
  const activeItem =
    !props.isLoading && activeIndex >= 0 && activeIndex < itemCount
      ? props.items[activeIndex]
      : undefined;
  const activeOptionId =
    activeItem === undefined ? undefined : optionId(activeItem);

  // Keep the active option scrolled into view as the highlight moves. Guard
  // for environments (jsdom) where `scrollIntoView` is not implemented.
  useEffect(() => {
    if (activeOptionId === undefined) return;
    const element = document.querySelector(`#${CSS.escape(activeOptionId)}`);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeOptionId]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Only take over navigation keys while the listbox is visible; otherwise
    // leave normal typing/caret behavior alone.
    if (!showPopover) return;
    // Never hijack keys mid-IME-composition: an Enter that confirms a CJK
    // composition still fires here with `isComposing` set, and intercepting it
    // would select an option instead of committing the composed text.
    if (event.nativeEvent.isComposing) return;
    const lastIndex = itemCount - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) =>
          index < 0 ? 0 : Math.min(index + 1, lastIndex),
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => (index < 0 ? 0 : Math.max(index - 1, 0)));
        break;
      // Home/End are deliberately not handled: they must move the text caret to
      // the start/end of the value being edited (a long Riot ID, alias, or
      // timezone search), not the virtual option highlight.
      case "Enter":
        // Only intercept Enter when there is an active option to commit —
        // otherwise let it behave normally (e.g. submit an enclosing form).
        if (activeItem !== undefined) {
          event.preventDefault();
          props.onSelect(activeItem);
          setOpen(false);
        }
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={props.id}
          // Randomized name so Chrome has no saved form-history to offer —
          // `autoComplete="off"` alone doesn't suppress the native dropdown.
          name={`cbx-${listId}`}
          value={props.value}
          disabled={props.disabled}
          placeholder={props.placeholder}
          role="combobox"
          aria-expanded={showPopover}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          className={props.className}
          onChange={(event) => {
            props.onValueChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            props.onBlur?.();
          }}
          onKeyDown={handleKeyDown}
        />
      </PopoverAnchor>
      <PopoverContent
        // Keep focus in the input while results render/update.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        className="max-h-72 overflow-y-auto p-1"
      >
        {props.isLoading && props.items.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            Searching…
          </p>
        ) : (
          <ul id={listId} role="listbox">
            {props.items.map((item, index) => {
              const isActive = index === activeIndex;
              return (
                <li key={props.getKey(item)}>
                  <button
                    type="button"
                    id={optionId(item)}
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                      "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                      isActive && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => {
                      props.onSelect(item);
                      setOpen(false);
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                  >
                    {props.renderItem(item)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
