import { useId, useState, type ReactNode, type Ref } from "react";
import { Check, Search } from "lucide-react";

export type CommandItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown as a checkbox: on, off, or not a checkbox at all. */
  checked?: boolean;
  hint?: string;
};

/**
 * A filterable list driven from its search field, in the manner of cmdk:
 * arrows move, Enter chooses, Backspace on an empty query steps back.
 */
export function CommandList({
  label,
  placeholder,
  items,
  choose,
  back,
  inputRef,
}: {
  label: string;
  placeholder: string;
  items: readonly CommandItem[];
  choose: (item: CommandItem) => void;
  back?: () => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const needle = query.trim().toLowerCase();
  const shown = items.filter((item) =>
    item.label.toLowerCase().includes(needle),
  );
  const active = Math.min(selected, shown.length - 1);
  const optionId = (index: number) => `${id}-option-${String(index)}`;
  function move(delta: number) {
    if (shown.length === 0) {
      return;
    }
    const next = (active + delta + shown.length) % shown.length;
    setSelected(next);
    document
      .querySelector(`#${CSS.escape(optionId(next))}`)
      ?.scrollIntoView({ block: "nearest" });
  }
  return (
    <div className="command-list">
      <div className="command-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            shown.length === 0 ? undefined : optionId(active)
          }
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            }
            const item = shown[active];
            if (item !== undefined && event.key === "Enter") {
              event.preventDefault();
              choose(item);
            }
            if (
              back !== undefined &&
              query === "" &&
              event.key === "Backspace"
            ) {
              event.preventDefault();
              back();
            }
          }}
        />
      </div>
      <div
        className="command-items"
        role="listbox"
        id={`${id}-list`}
        aria-label={label}
        aria-multiselectable={items.some((item) => item.checked !== undefined)}
      >
        {shown.map((item, index) => (
          <button
            type="button"
            key={item.id}
            role="option"
            tabIndex={-1}
            id={optionId(index)}
            className="picker-item"
            aria-selected={item.checked ?? false}
            data-highlighted={active === index ? "" : undefined}
            onPointerMove={() => {
              setSelected(index);
            }}
            onPointerDown={(event) => {
              // Keep focus in the search field.
              event.preventDefault();
            }}
            onClick={() => {
              choose(item);
            }}
          >
            {item.checked !== undefined && (
              <span
                className="picker-box"
                data-state={item.checked ? "on" : "off"}
                aria-hidden="true"
              >
                {item.checked && <Check size={12} />}
              </span>
            )}
            {item.icon !== undefined && (
              <span className="option-icon">{item.icon}</span>
            )}
            <span className="option-label">{item.label}</span>
            {item.hint !== undefined && (
              <span className="picker-detail">{item.hint}</span>
            )}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="picker-empty">No matches</p>}
    </div>
  );
}
