import { clsx } from "clsx";
import { cloneElement, type ComponentProps, type ReactElement } from "react";
import type { ButtonVariant } from "@shepherdjerred/console-ui/components/button.tsx";

export type ButtonLinkProps = Omit<ComponentProps<"a">, "className"> & {
  /** `primary` fills with the accent; `danger` is for destructive actions. */
  readonly variant?: ButtonVariant;
  readonly className?: string;
  /**
   * A router link element (`<Link to="/new" />`) to render instead of a
   * plain `<a>`. It receives the button classes and `children`; no role is
   * added.
   */
  readonly render?: ReactElement<{ className?: string }>;
};

/**
 * A link that looks like a `Button`: a real `<a href>` (or your router's
 * link via `render`) with the `ui-btn` classes. Unlike `<Button render={<a/>}>`
 * it adds no `role="button"`, so it stays a link for assistive technology
 * and tests.
 */
export function ButtonLink({
  variant = "default",
  className,
  render,
  children,
  ...props
}: ButtonLinkProps): React.JSX.Element {
  const shared = {
    ...props,
    className: clsx("ui-btn", className),
    "data-variant": variant,
    "data-size": "compact",
  };
  return render === undefined ? (
    <a {...shared}>{children}</a>
  ) : (
    cloneElement(render, shared, children)
  );
}
