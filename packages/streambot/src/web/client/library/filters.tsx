import { useEffect, useState, type ReactNode } from "react";
import { withCurrent, type FilterOption } from "./filter-options.ts";
import "@shepherdjerred/streambot/web/client/styles/browse.css";

/** The row of filters above a list. */
export function FilterBar(props: { label: string; children: ReactNode }) {
  return (
    <div className="filter-bar" role="group" aria-label={props.label}>
      {props.children}
    </div>
  );
}

/** A text filter applied on Enter or the Filter button; `value` is what the address holds now. */
export function TextFilter(props: {
  label: string;
  placeholder: string;
  value: string;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);
  return (
    <form
      className="filter-text"
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply(draft.trim());
      }}
    >
      <label className="filter-field">
        {props.label}
        <input
          type="search"
          name="q"
          maxLength={300}
          placeholder={props.placeholder}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      </label>
      <button type="submit" className="btn">
        Filter
      </button>
    </form>
  );
}

export function SelectFilter(props: {
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      {props.label}
      <select
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        {withCurrent(props.options, props.value).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
