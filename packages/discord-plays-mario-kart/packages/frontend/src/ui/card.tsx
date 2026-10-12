import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-border-subtle bg-surface-card shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5",
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon === undefined ? null : (
          <span className="text-ink-faint">{icon}</span>
        )}
        {title}
      </h2>
      {action}
    </div>
  );
}
