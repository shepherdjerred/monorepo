import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

/**
 * The soft surface of the friendly layout.
 *
 * - `panel`: a raised, large-radius surface for the thing the reader came for.
 * - `open`: no surface at all, only the padding, for content that sits on the
 *   ground beside a panel.
 * - `hero`: a panel with no padding that clips its content, for a page's lead
 *   block with art; the caller lays out the inside.
 */
export const panelVariants = cva("scout-soft-panel", {
  variants: {
    variant: {
      panel: "scout-soft-panel--panel",
      open: "scout-soft-panel--open",
      hero: "scout-soft-panel--hero",
    },
  },
  defaultVariants: { variant: "panel" },
});

export type PanelProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof panelVariants> & {
    /** Render the child element instead of a `div`, for example a `section`. */
    asChild?: boolean;
  };

export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ asChild = false, className, variant, ...props }, ref) => {
    const Component = asChild ? Slot : "div";
    return (
      <Component
        ref={ref}
        className={cn(panelVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
Panel.displayName = "Panel";
