import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border-strong bg-surface-raised px-1.5 font-mono text-[10px] font-semibold text-ink-muted shadow-[0_1px_0_var(--color-border-strong)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
