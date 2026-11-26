import { useId, type ReactNode } from "react";

export type FieldsetProps = {
  readonly legend: string;
  readonly hint?: string;
  /** Shown under the group and linked with `aria-describedby`. */
  readonly error?: string;
  readonly children: ReactNode;
};

/** A native `<fieldset>`: a legend, a hint, and the grouped controls. */
export function Fieldset({
  legend,
  hint,
  error,
  children,
}: FieldsetProps): React.JSX.Element {
  const id = useId();
  const describedBy = [
    hint === undefined ? undefined : `${id}-hint`,
    error === undefined ? undefined : `${id}-error`,
  ]
    .filter((value) => value !== undefined)
    .join(" ");
  return (
    <fieldset
      className="ui-fieldset"
      aria-describedby={describedBy === "" ? undefined : describedBy}
      aria-invalid={error === undefined ? undefined : true}
    >
      <legend className="ui-fieldset-legend">{legend}</legend>
      {hint === undefined ? null : (
        <p className="ui-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <div className="ui-fieldset-body">{children}</div>
      {error === undefined ? null : (
        <p className="ui-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
