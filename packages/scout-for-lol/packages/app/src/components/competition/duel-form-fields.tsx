import { z } from "zod";

export function optionalDuelIntegerTarget(minimum: number, maximum: number) {
  return z
    .union([z.literal(""), z.string().regex(/^\d+$/)])
    .transform((value) => (value === "" ? null : Number(value)))
    .pipe(z.number().int().min(minimum).max(maximum).nullable());
}

export function FirstTurretField(props: {
  id: string;
  name: string;
  checked: boolean;
  onBlur: () => void;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex items-center gap-2 self-end pb-3 text-sm font-medium"
      htmlFor={props.id}
    >
      <input
        id={props.id}
        name={props.name}
        type="checkbox"
        checked={props.checked}
        onBlur={props.onBlur}
        onChange={(event) => {
          props.onChange(event.currentTarget.checked);
        }}
      />
      First turret wins
    </label>
  );
}

export function DuelOptionSelectField(props: {
  id: string;
  name: string;
  label: string;
  value: string;
  placeholder: string;
  options: readonly { readonly value: string; readonly label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm" htmlFor={props.id}>
      <span className="font-medium">{props.label}</span>
      <select
        className="scout-control"
        id={props.id}
        name={props.name}
        required
        value={props.value}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
      >
        <option value="">{props.placeholder}</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
