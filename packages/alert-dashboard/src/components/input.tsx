import { Input as InputPrimitive } from "@base-ui/react/input";

/** Base UI's input with Hub's `input` class ahead of any caller class. */
export function Input({
  className,
  ...props
}: React.ComponentProps<"input">): React.JSX.Element {
  return (
    <InputPrimitive
      className={
        className === undefined || className === ""
          ? "input"
          : `input ${className}`
      }
      {...props}
    />
  );
}
