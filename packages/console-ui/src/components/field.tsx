import { useId, type ReactNode } from "react";

/** Props to spread onto the `<input>`, `<select>` or `<textarea>`. */
export type FieldControlProps = {
  readonly id: string;
  readonly className: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
};

export type FieldProps = {
  readonly label: string;
  /** The control's id; give one when an `ErrorSummary` must link to it. */
  readonly id?: string;
  /**
   * `stacked` puts the label above the control. `inline` draws one bordered
   * box holding both, for toolbar filters.
   */
  readonly layout?: "stacked" | "inline";
  readonly hint?: string;
  /** Marks the control invalid and describes it. */
  readonly error?: string | undefined;
  readonly children: (control: FieldControlProps) => ReactNode;
};

export function Field({
  label,
  id: givenId,
  layout = "stacked",
  hint,
  error,
  children,
}: FieldProps): React.JSX.Element {
  const generatedId = useId();
  const id = givenId ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value) => value !== undefined)
    .join(" ");
  return (
    <div
      className="ui-field"
      data-layout={layout}
      data-invalid={error === undefined ? undefined : ""}
    >
      <div className="ui-field-box">
        <label className="ui-field-label" htmlFor={id}>
          {label}
        </label>
        {children({
          id,
          className: "ui-field-control",
          "aria-describedby": describedBy === "" ? undefined : describedBy,
          "aria-invalid": error === undefined ? undefined : true,
        })}
      </div>
      {hint === undefined ? null : (
        <p className="ui-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="ui-field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
