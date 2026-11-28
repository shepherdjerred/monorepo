import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type { ReactNode } from "react";

export type SwitchProps = Omit<
  SwitchPrimitive.Root.Props,
  "className" | "children"
> & {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
};

/** A Base UI switch for settings that apply at once, with its label. */
export function Switch({
  label,
  hint,
  ...props
}: SwitchProps): React.JSX.Element {
  return (
    <label className="ui-choice">
      <SwitchPrimitive.Root {...props} className="ui-switch">
        <SwitchPrimitive.Thumb className="ui-switch-thumb" />
      </SwitchPrimitive.Root>
      <span className="ui-choice-text">
        {label}
        {hint === undefined ? null : (
          <span className="ui-choice-hint">{hint}</span>
        )}
      </span>
    </label>
  );
}
