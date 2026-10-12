import type { ReactNode } from "react";
import { cx } from "./cx.ts";

type Tone = "neutral" | "success" | "warning" | "danger" | "brand" | "discord";

const TONES: Record<Tone, string> = {
  neutral: "border-border-strong bg-surface-raised text-ink-muted",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  danger: "border-red-500/25 bg-red-500/10 text-red-300",
  brand: "border-brand/30 bg-brand-soft text-red-200",
  discord: "border-discord/30 bg-discord/15 text-indigo-200",
};

export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
