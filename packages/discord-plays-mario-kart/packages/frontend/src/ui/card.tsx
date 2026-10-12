import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";
import { Kerb } from "./mk.tsx";

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-border-subtle bg-[linear-gradient(180deg,#141c45,#0f1636)] shadow-card",
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
      <h2 className="flex items-center gap-2.5 text-ink">
        <Kerb className="h-4 w-1.5" />
        {icon === undefined ? null : (
          <span className="text-mk-yellow">{icon}</span>
        )}
        <span className="mk-title text-lg tracking-wide">{title}</span>
      </h2>
      {action}
    </div>
  );
}
