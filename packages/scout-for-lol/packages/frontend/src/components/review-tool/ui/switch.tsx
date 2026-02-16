import type { InputHTMLAttributes } from "react";
import { cn } from "./cn.ts";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <label
      className={cn(
        "relative inline-flex h-5 w-9 cursor-pointer items-center",
        className,
      )}
    >
      <input type="checkbox" className="peer sr-only" {...props} />
      <span className="absolute inset-0 rounded-full bg-surface-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500" />
      <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
    </label>
  );
}
