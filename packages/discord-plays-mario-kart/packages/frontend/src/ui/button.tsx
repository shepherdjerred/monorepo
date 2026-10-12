import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

type Variant = "primary" | "secondary" | "ghost" | "discord";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(180deg,#ff3448,#c40f24)] text-mk-yellow shadow-[0_3px_0_#7a0915] hover:brightness-110",
  secondary:
    "border border-border-strong bg-surface-raised text-ink hover:border-ink-faint hover:bg-surface-raised/80",
  ghost: "text-ink-muted hover:bg-white/5 hover:text-ink",
  discord:
    "bg-discord text-white shadow-[0_3px_0_#3a44b0,0_8px_24px_-10px_var(--color-discord)] hover:bg-discord-strong",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-12 gap-2.5 rounded-xl px-5 text-base",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-discord disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
