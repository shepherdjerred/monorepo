import { useRef, type ReactNode } from "react";
import {
  durationInput,
  durationUnit,
  durationUnitName,
  parseDuration,
  type DurationRules,
} from "./duration.ts";
import { InlineSelect, TextField } from "./field.tsx";
import { useClearFieldError } from "./form.tsx";

/**
 * A length of time: an amount and the unit it is in. `readDuration` reads
 * the two back out of the submitted form as the seconds the contract
 * stores.
 *
 * What is wrong with the pair (below the shortest time, not a whole number
 * of seconds in this unit) is set on the amount as its own validity, so the
 * surrounding form reports it like any other constraint.
 */
export function DurationField({
  label,
  description,
  optional = false,
  requiredMessage,
  name,
  rules,
  defaultSeconds,
}: {
  label: string;
  description?: ReactNode;
  optional?: boolean;
  requiredMessage?: string;
  name: string;
  rules: DurationRules;
  /** The stored value, or `null` when there is none. */
  defaultSeconds: number | null;
}) {
  const amount = useRef<HTMLInputElement>(null);
  const unit = useRef<HTMLSelectElement>(null);
  const clearError = useClearFieldError();
  const start = durationInput(defaultSeconds, rules);

  /** Whether the amount, in the chosen unit, is a time this field takes. */
  function check(): boolean {
    if (amount.current === null || unit.current === null) return false;
    const parsed = parseDuration(
      amount.current.value,
      durationUnit(unit.current.value),
      rules,
    );
    amount.current.setCustomValidity(parsed.ok ? "" : parsed.message);
    return amount.current.validity.valid;
  }

  return (
    <TextField
      label={label}
      description={description}
      optional={optional}
      requiredMessage={requiredMessage}
      name={name}
      type="number"
      step="any"
      required={!optional}
      defaultValue={start.amount}
      ref={amount}
      onChange={check}
      width="full"
      after={
        <InlineSelect
          label={`Unit of the ${label.toLowerCase()}`}
          name={durationUnitName(name)}
          defaultValue={start.unit}
          ref={unit}
          onChange={() => {
            // The form clears an error when its own control changes; here
            // the unit changed and the error belongs to the amount.
            if (check()) clearError(name);
          }}
        >
          {rules.units.map((offered) => (
            <option key={offered} value={offered}>
              {offered}
            </option>
          ))}
        </InlineSelect>
      }
    />
  );
}
