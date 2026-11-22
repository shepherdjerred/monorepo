import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import { classNames } from "./class-names.ts";
import styles from "./button.module.css";

const cx = classNames(styles);

type ButtonProps = Omit<ComponentProps<"button">, "className"> & {
  /**
   * `primary` is the one action a form or section is for, `danger` is an
   * action that cannot be undone, and `quiet` is a minor action in a row.
   */
  variant?: "primary" | "secondary" | "quiet" | "danger";
  /** Shown while the action it started is still running. */
  busy?: boolean;
};

/**
 * A button. It is `type="button"` unless told otherwise, so a helper inside
 * a form never submits it by accident.
 */
export function Button({
  variant = "secondary",
  busy = false,
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={
        variant === "secondary"
          ? cx("button")
          : `${cx("button")} ${cx(variant)}`
      }
      type={type}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}

/** A link to another page that reads as an action. */
export function ButtonLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className={cx("button")} to={to}>
      {children}
    </Link>
  );
}

/** Buttons that belong together, on one line when there is room. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className={cx("row")}>{children}</div>;
}
