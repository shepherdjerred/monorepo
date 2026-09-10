import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef } from "react";
import { cn } from "#src/lib/cn.ts";

export const Switch = forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn("scout-switch", className)}
    {...props}
  >
    <SwitchPrimitive.Thumb className="scout-switch__thumb" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
