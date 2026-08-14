import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "#src/lib/cn.ts";

/**
 * A side panel, built on the same Radix dialog as {@link Dialog}.
 *
 * Deliberately uses `transition-transform` with `data-[state=…]` rather than
 * the `animate-in` / `slide-in-from-left` utilities a shadcn sheet ships with:
 * this app has no `tailwindcss-animate` and Tailwind v4 does not provide those
 * classes, so they are silent no-ops here (as they already are in dialog.tsx
 * and popover.tsx). A plain transform transition actually moves.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
        "data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
      )}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-4",
        "border-r border-border bg-background p-4 shadow-lg",
        "transition-transform duration-200 ease-out",
        "data-[state=closed]:-translate-x-full data-[state=open]:translate-x-0",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-4 top-4 rounded-sm opacity-70 transition-opacity",
          "hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:pointer-events-none",
        )}
      >
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
