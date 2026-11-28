import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";

export type RadioOption = {
  readonly value: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly disabled?: boolean;
};

export type RadioGroupProps = Omit<
  RadioGroupPrimitive.Props<string>,
  "className" | "children" | "aria-label"
> & {
  /** Accessible name of the group; use a `Fieldset` legend for a visible one. */
  readonly label: string;
  readonly options: readonly RadioOption[];
  readonly invalid?: boolean;
};

/** A Base UI radio group: one tab stop, arrow keys move the choice. */
export function RadioGroup({
  label,
  options,
  invalid = false,
  ...props
}: RadioGroupProps): React.JSX.Element {
  return (
    <RadioGroupPrimitive
      {...props}
      className="ui-choices"
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
    >
      {options.map((option) => (
        <label key={option.value} className="ui-choice">
          <Radio.Root
            value={option.value}
            disabled={option.disabled}
            className="ui-choice-box"
            data-shape="radio"
          >
            <Radio.Indicator className="ui-choice-dot" keepMounted={false} />
          </Radio.Root>
          <span className="ui-choice-text">
            {option.label}
            {option.hint === undefined ? null : (
              <span className="ui-choice-hint">{option.hint}</span>
            )}
          </span>
        </label>
      ))}
    </RadioGroupPrimitive>
  );
}
