import { clsx } from "clsx";
import type { ReactNode } from "react";

export type InputAddonProps = React.ComponentProps<"input"> & {
  /** Fixed text before the value, such as `go/`. */
  readonly prefix?: ReactNode;
  /** Fixed text after the value, such as `.example.com`. */
  readonly suffix?: ReactNode;
};

/**
 * An input with a fixed prefix or suffix inside the one border. Spread
 * `Field`'s control props onto it; `aria-invalid` tints the whole box.
 */
export function InputAddon({
  prefix,
  suffix,
  className,
  ...props
}: InputAddonProps): React.JSX.Element {
  return (
    <span
      className="ui-addon"
      data-invalid={props["aria-invalid"] === undefined ? undefined : ""}
    >
      {prefix === undefined ? null : (
        <span className="ui-addon-text ui-mono">{prefix}</span>
      )}
      <input
        {...props}
        className={clsx("ui-field-control", "ui-addon-input", className)}
      />
      {suffix === undefined ? null : (
        <span className="ui-addon-text ui-mono">{suffix}</span>
      )}
    </span>
  );
}
