import { ChevronDownIcon } from "lucide-react";
import { classNames } from "./class-names.ts";
import styles from "./choice.module.css";

const cx = classNames(styles);

/**
 * A native select drawn as a chip: the browser's own picker, the client's
 * face. It is marked when it narrows the list it sits above.
 *
 * `label` is the control's name, for assistive technology only: the chosen
 * option's words are what is shown.
 */
export function Choice<Value extends string>({
  label,
  value,
  values,
  labels,
  resting,
  onChange,
}: {
  label: string;
  value: Value;
  values: readonly Value[];
  labels: Record<Value, string>;
  /** The value that leaves the list as it is. */
  resting: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <label className={cx("choice")} data-active={value !== resting}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          const chosen = values.find(
            (candidate) => candidate === event.target.value,
          );
          if (chosen === undefined) {
            throw new Error(`${label} has no option ${event.target.value}`);
          }
          onChange(chosen);
        }}
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
      <ChevronDownIcon aria-hidden="true" />
    </label>
  );
}
