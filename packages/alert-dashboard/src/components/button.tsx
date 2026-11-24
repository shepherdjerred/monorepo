import { Button as ButtonPrimitive } from "@base-ui/react/button";

/** Base UI's button with Hub's `button` class ahead of any caller class. */
export function Button({
  className,
  ...props
}: ButtonPrimitive.Props): React.JSX.Element {
  return (
    <ButtonPrimitive
      className={
        typeof className === "function"
          ? (state) => joinClass("button", className(state))
          : joinClass("button", className)
      }
      {...props}
    />
  );
}

function joinClass(base: string, extra: string | undefined): string {
  return extra === undefined || extra === "" ? base : `${base} ${extra}`;
}
