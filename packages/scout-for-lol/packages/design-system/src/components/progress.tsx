import * as ProgressPrimitive from "@radix-ui/react-progress";
import { forwardRef } from "react";
import { cn } from "#src/lib/cn.ts";

export const Progress = forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("scout-progress", className)}
    value={value}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="scout-progress__indicator"
      style={{ transform: `translateX(-${String(100 - (value ?? 0))}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = "Progress";
