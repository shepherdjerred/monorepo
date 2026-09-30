import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "#src/lib/cn.ts";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetTitle = DialogPrimitive.Title;
export const SheetClose = DialogPrimitive.Close;
export const SheetContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="scout-overlay" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn("scout-sheet", className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="scout-button scout-button--ghost scout-button--icon scout-dialog__close">
        <X size={18} aria-hidden="true" />
        <span className="scout-sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
