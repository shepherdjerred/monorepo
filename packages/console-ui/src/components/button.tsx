import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { clsx } from "clsx";

export type ButtonVariant = "default" | "primary";

/** `compact` is the 28px toolbar button; `page` is the 36px page-kit button. */
export type ButtonSize = "compact" | "page";

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
};

/** A pressable button. Lucide icons inside it pick up the muted colour. */
export function Button({
  variant = "default",
  size = "compact",
  className,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <ButtonPrimitive
      {...props}
      className={clsx("ui-btn", className)}
      data-variant={variant}
      data-size={size}
    />
  );
}
