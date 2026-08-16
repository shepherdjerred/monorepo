import type { HTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

export function Spinner({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("scout-spinner", className)}
      {...props}
    />
  );
}
