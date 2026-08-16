import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { forwardRef } from "react";
import { cn } from "#src/lib/cn.ts";

export const ToggleGroup = forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("scout-toggle-group", className)}
    {...props}
  />
));
ToggleGroup.displayName = "ToggleGroup";

export const ToggleGroupItem = forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & {
    variant?: "default" | "outline";
  }
>(({ className, variant = "default", ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    data-variant={variant}
    className={cn("scout-toggle-group__item", className)}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";
