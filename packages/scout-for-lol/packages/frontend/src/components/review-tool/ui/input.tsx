import type { DetailedHTMLProps, InputHTMLAttributes } from "react";
import { cn } from "./cn.ts";

type InputProps = DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500",
        className,
      )}
      {...props}
    />
  );
}
