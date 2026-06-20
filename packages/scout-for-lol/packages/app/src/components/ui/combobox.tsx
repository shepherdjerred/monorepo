import { useId, useState } from "react";
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
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hasQuery = props.value.trim().length > 0;
  // Only show the popover while searching or when there are results — never an
  // empty "no results" box.
  const showPopover =
    open && hasQuery && (props.isLoading || props.items.length > 0);

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
        />
      </PopoverAnchor>
      <PopoverContent
        id={listId}
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
          <ul>
            {props.items.map((item) => (
              <li key={props.getKey(item)}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                    "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                  )}
                  onClick={() => {
                    props.onSelect(item);
                    setOpen(false);
                  }}
                >
                  {props.renderItem(item)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
