import {
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "#src/lib/cn.ts";
import { Input } from "./field.tsx";
import { Popover, PopoverAnchor, PopoverContent } from "./popover.tsx";

export type ComboboxProps<T> = {
  value: string;
  onValueChange: (value: string) => void;
  items: T[];
  isLoading: boolean;
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  id?: string | undefined;
  openOnEmptyQuery?: boolean | undefined;
  onBlur?: (() => void) | undefined;
};

export function Combobox<T>(props: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const showPopover =
    open &&
    (props.value.trim().length > 0 || props.openOnEmptyQuery === true) &&
    (props.isLoading || props.items.length > 0);
  const signature = props.items.map((item) => props.getKey(item)).join(" ");

  useEffect(() => {
    setActiveIndex(showPopover && props.items.length > 0 ? 0 : -1);
  }, [showPopover, props.items.length, signature]);
  const activeItem =
    !props.isLoading && activeIndex >= 0 ? props.items[activeIndex] : undefined;
  const optionId = (item: T): string =>
    `${listId}-${encodeURIComponent(props.getKey(item))}`;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!showPopover || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, props.items.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
    if (activeItem !== undefined && event.key === "Enter") {
      event.preventDefault();
      props.onSelect(activeItem);
      setOpen(false);
    }
  }

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={props.id}
          value={props.value}
          disabled={props.disabled}
          placeholder={props.placeholder}
          role="combobox"
          aria-expanded={showPopover}
          aria-controls={listId}
          aria-activedescendant={
            activeItem === undefined ? undefined : optionId(activeItem)
          }
          autoComplete="off"
          className={props.className}
          onChange={(event) => {
            props.onValueChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={props.onBlur}
          onKeyDown={onKeyDown}
        />
      </PopoverAnchor>
      <PopoverContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <ul id={listId} role="listbox">
          {props.isLoading && props.items.length === 0 ? (
            <li className="scout-muted">Searching…</li>
          ) : (
            props.items.map((item, index) => (
              <li key={props.getKey(item)}>
                <button
                  type="button"
                  id={optionId(item)}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn("scout-combobox__option")}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    props.onSelect(item);
                    setOpen(false);
                  }}
                >
                  {props.renderItem(item)}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
