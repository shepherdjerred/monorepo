import { classNames } from "./class-names.ts";
import styles from "./date-field.module.css";

const cx = classNames(styles);

/**
 * The browser's own date field, drawn as a chip to sit beside `Choice`.
 *
 * `label` is the word shown in the chip ("From"); `name` is the field's full
 * name for assistive technology and must contain that word. `value` is
 * `YYYY-MM-DD`, or null for no day. `onChange` is given the same, or an empty
 * string when the field names no day: a browser reports a half-typed date as
 * empty.
 */
export function DateField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className={cx("field")} data-empty={value === null}>
      <span>{label}</span>
      <input
        type="date"
        aria-label={name}
        value={value ?? ""}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}
