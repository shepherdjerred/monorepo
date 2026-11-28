import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { clsx } from "clsx";

export type ButtonVariant = "default" | "primary" | "danger";

/**
 * @deprecated There is one button size, 28px. `page` is the page kit's 36px
 * button, kept only until Go link and Flags move off the page kit (K1).
 */
export type ButtonSize = "compact" | "page";

export type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & {
  /** `primary` fills with the accent; `danger` is for destructive actions. */
  readonly variant?: ButtonVariant;
  /**
   * @deprecated The 28px button is the only size; `page` keeps the page
   * kit's 36px button until it is deleted (K1).
   */
  readonly size?: ButtonSize;
  readonly className?: string;
};

/**
 * The 28px pressable button. Lucide icons inside it pick up the muted
 * colour. For a link styled as a button use `ButtonLink`: Base UI puts
 * `role="button"` on a `render={<a/>}` anchor, which breaks link semantics.
 */
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
