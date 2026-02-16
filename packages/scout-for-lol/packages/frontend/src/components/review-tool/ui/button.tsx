import type { ButtonHTMLAttributes, DetailedHTMLProps, ReactNode } from "react";
import { cn } from "./cn.ts";

type ButtonProps = DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "primary" | "secondary";
  size?: "sm" | "md";
  icon?: ReactNode;
  isLoading?: boolean;
};

export function Button({
  className,
  children,
  variant = "default",
  size = "md",
  icon,
  isLoading = false,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    default: "bg-black text-white hover:bg-brand-700 focus:ring-brand-500",
    primary: "bg-black text-white hover:bg-brand-700 focus:ring-brand-500",
    secondary: "bg-surface-100 text-surface-900 hover:bg-surface-200 focus:ring-brand-500",
    outline: "border border-surface-300 text-surface-900 hover:bg-surface-50 focus:ring-brand-500",
    ghost: "text-surface-700 hover:bg-surface-100 focus:ring-brand-500",
  };
  const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
  };

  const isDisabled = isLoading || Boolean(disabled);

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={isDisabled} {...props}>
      {icon && <span className="mr-2 flex items-center">{icon}</span>}
      {children}
    </button>
  );
}
