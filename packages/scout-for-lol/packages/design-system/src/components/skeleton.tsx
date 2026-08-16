import type { HTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("scout-skeleton", className)}
      {...props}
    />
  );
}
