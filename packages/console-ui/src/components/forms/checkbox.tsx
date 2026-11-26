import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import type { ReactNode } from "react";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

export type CheckboxProps = Omit<
  CheckboxPrimitive.Root.Props,
  "className" | "children"
> & {
  readonly label: ReactNode;
  /** Muted line under the label. */
  readonly hint?: ReactNode;
  readonly invalid?: boolean;
};

const Tick = ICONS.copied;

/** A Base UI checkbox with its label; the whole row is the click target. */
export function Checkbox({
  label,
  hint,
  invalid = false,
  ...props
}: CheckboxProps): React.JSX.Element {
  return (
    <label className="ui-choice">
      <CheckboxPrimitive.Root
        {...props}
        className="ui-choice-box"
        aria-invalid={invalid ? true : undefined}
      >
        <CheckboxPrimitive.Indicator
          className="ui-choice-mark"
          keepMounted={false}
        >
          <Tick aria-hidden="true" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="ui-choice-text">
        {label}
        {hint === undefined ? null : (
          <span className="ui-choice-hint">{hint}</span>
        )}
      </span>
    </label>
  );
}
