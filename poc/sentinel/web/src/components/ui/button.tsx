import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
};

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
  secondary:
    "bg-zinc-200 text-zinc-900 hover:bg-zinc-300 active:bg-zinc-400 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600",
  ghost:
    "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-2.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-50",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}
