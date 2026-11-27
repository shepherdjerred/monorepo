import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "#src/lib/cn.ts";

export const BottomSheet = DialogPrimitive.Root;
export const BottomSheetTrigger = DialogPrimitive.Trigger;
export const BottomSheetClose = DialogPrimitive.Close;
export const BottomSheetDescription = DialogPrimitive.Description;

export type BottomSheetContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  "title"
> & {
  /** The sheet's heading and its accessible name. */
  title: ReactNode;
};

/**
 * A sheet that rises from the bottom edge: a grab handle, a title row with a
 * 44px close button, then the content. It is a Radix dialog, so focus is
 * trapped while it is open and returns to the trigger on close, and Escape or
 * a press on the backdrop dismisses it. Motion is dropped under
 * `prefers-reduced-motion`.
 *
 * Pass `aria-describedby` and a `BottomSheetDescription` when the sheet has
 * descriptive text; otherwise it is left undescribed.
 */
export const BottomSheetContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  BottomSheetContentProps
>(({ children, className, title, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="scout-overlay" />
    <DialogPrimitive.Content
      ref={ref}
      aria-describedby={undefined}
      className={cn("scout-bottom-sheet", className)}
      {...props}
    >
      <div className="scout-bottom-sheet__handle" aria-hidden="true" />
      <div className="scout-bottom-sheet__header">
        <DialogPrimitive.Title className="scout-bottom-sheet__title">
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Close className="scout-button scout-button--ghost scout-button--icon scout-bottom-sheet__close">
          <X size={20} aria-hidden="true" />
          <span className="scout-sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
BottomSheetContent.displayName = "BottomSheetContent";
