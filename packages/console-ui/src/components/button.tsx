import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { clsx } from "clsx";

export type ButtonVariant = "default" | "primary";

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
  readonly variant?: ButtonVariant;
  readonly className?: string;
};

/** A 28px pressable button. Lucide icons inside it pick up the muted colour. */
export function Button({
  variant = "default",
  className,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <ButtonPrimitive
      {...props}
      className={clsx("ui-btn", className)}
      data-variant={variant}
    />
  );
}
