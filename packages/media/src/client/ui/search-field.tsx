import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { useLocation } from "react-router";
import { classNames } from "./class-names.ts";
import styles from "./search-field.module.css";

const cx = classNames(styles);

/**
 * A search field whose text lives in the page's address.
 *
 * It keeps its own text so typing never waits on the address, and takes the
 * address's text again whenever something else changes it (Back, a cleared
 * filter). `onChange` is given the trimmed text on every keystroke.
 */
export function SearchField({
  label,
  placeholder,
  query,
  limit,
  onChange,
}: {
  /** The field's name, for assistive technology. */
  label: string;
  placeholder: string;
  /** The search the address holds. */
  query: string;
  /** The most characters the read behind it accepts. */
  limit: number;
  onChange: (query: string) => void;
}) {
  const [text, setText] = useState(query);
  const { key } = useLocation();
  const [syncedTo, setSyncedTo] = useState(key);
  if (syncedTo !== key) {
    setSyncedTo(key);
    if (text.trim() !== query) setText(query);
  }
  return (
    <label className={cx("field")}>
      <SearchIcon aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        placeholder={placeholder}
        value={text}
        maxLength={limit}
        enterKeyHint="search"
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.trim());
        }}
      />
    </label>
  );
}
