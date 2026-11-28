import { Field } from "@shepherdjerred/console-ui";
import type { ComponentProps } from "react";

import type { ExperimentPlan } from "@shepherdjerred/experiments/contract";
import { PLAN_FIELDS } from "./presentation.tsx";

type InputProps = Omit<ComponentProps<"input">, "children"> & {
  readonly label: string;
  readonly hint?: string | undefined;
};

export function TextInput({ label, hint, ...props }: InputProps) {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => <input {...control} {...props} />}
    </Field>
  );
}

export function TextArea({
  label,
  ...props
}: ComponentProps<"textarea"> & { readonly label: string }) {
  return (
    <Field label={label}>
      {(control) => (
        <textarea {...control} rows={3} maxLength={8000} {...props} />
      )}
    </Field>
  );
}

export function PlanFields({ plan }: { readonly plan?: ExperimentPlan }) {
  return (
    <fieldset className="experiments-form-fields">
      <legend>Experiment plan</legend>
      {PLAN_FIELDS.map(({ name, label }) => (
        <TextArea
          key={name}
          name={name}
          label={label}
          defaultValue={plan?.[name]}
        />
      ))}
    </fieldset>
  );
}

export function fieldText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function readPlan(form: FormData): ExperimentPlan {
  return {
    change: fieldText(form, "change"),
    hypothesis: fieldText(form, "hypothesis"),
    scope: fieldText(form, "scope"),
    successCriteria: fieldText(form, "successCriteria"),
    measurementMethod: fieldText(form, "measurementMethod"),
    baseline: fieldText(form, "baseline"),
    guardrails: fieldText(form, "guardrails"),
  };
}
