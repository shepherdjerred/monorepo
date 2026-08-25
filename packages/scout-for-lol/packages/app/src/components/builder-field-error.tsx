import { FieldError } from "@scout-for-lol/design-system/components/input";

export function builderErrorAttributes(
  error: string | undefined,
  errorId: string,
) {
  return error === undefined
    ? {}
    : { "aria-invalid": true as const, "aria-describedby": errorId };
}

export function BuilderFieldError(props: {
  id: string;
  error: string | undefined;
}) {
  return props.error === undefined ? null : (
    <FieldError id={props.id}>{props.error}</FieldError>
  );
}
