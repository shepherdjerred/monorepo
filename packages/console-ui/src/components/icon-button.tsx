import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

export type IconButtonProps = Omit<
  ButtonPrimitive.Props,
  "children" | "aria-label" | "className"
> & {
  readonly icon: LucideIcon;
  /** Required: the button has no visible text. */
  readonly label: string;
  readonly className?: string;
};

export function IconButton({
  icon,
  label,
  className,
  ...props
}: IconButtonProps): React.JSX.Element {
  const Icon = icon;
  return (
    <ButtonPrimitive
      {...props}
      aria-label={label}
      className={clsx("ui-icon-btn", className)}
    >
      <Icon aria-hidden="true" />
    </ButtonPrimitive>
  );
}
