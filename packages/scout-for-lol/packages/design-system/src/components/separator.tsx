import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { forwardRef } from "react";
import { cn } from "#src/lib/cn.ts";

export const Separator = forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, decorative = true, orientation = "horizontal", ...props },
    ref,
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn("scout-separator", className)}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";
