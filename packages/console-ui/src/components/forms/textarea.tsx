import { clsx } from "clsx";

export type TextareaProps = React.ComponentProps<"textarea">;

/**
 * A multi-line input on the field look. Spread `Field`'s control props onto
 * it: `<Field label="Notes">{(c) => <Textarea {...c} />}</Field>`.
 */
export function Textarea({
  className,
  rows = 4,
  ...props
}: TextareaProps): React.JSX.Element {
  return (
    <textarea
      {...props}
      rows={rows}
      className={clsx("ui-field-control", className)}
    />
  );
}
