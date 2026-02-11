import type { DetailedHTMLProps, LabelHTMLAttributes } from "react";
import { cn } from "./cn.ts";

type LabelProps = DetailedHTMLProps<LabelHTMLAttributes<HTMLLabelElement>, HTMLLabelElement>;

export function Label({ className, children, ...props }: LabelProps) {
  return (
    <label className={cn("text-sm font-medium text-surface-800", className)} {...props}>
      {children}
    </label>
  );
}
