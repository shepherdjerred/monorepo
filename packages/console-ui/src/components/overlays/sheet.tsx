import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";
import { leavingPopup } from "@shepherdjerred/console-ui/components/overlays/leaving-popup.tsx";
import { openStateProps } from "@shepherdjerred/console-ui/components/overlays/open-state.ts";

const CloseIcon = ICONS.close;

export type SheetSide = "right" | "left" | "bottom";

export type SheetProps = {
  readonly title: ReactNode;
  /** Muted sentence under the title, read as the sheet's description. */
  readonly description?: ReactNode;
  /**
   * `right` (default) and `left` slide in beside the page, for a side panel
   * or peek; `bottom` rises from the bottom edge, for a phone's "More".
   */
  readonly side?: SheetSide;
  /** `md` 400px (default) or `lg` 560px wide; a side sheet is full width on a phone. */
  readonly size?: "md" | "lg";
  /** Buttons pinned to the bottom, primary last. */
  readonly actions?: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** An element that opens the sheet, e.g. `<Button>More</Button>`. */
  readonly trigger?: ReactElement;
  readonly children?: ReactNode;
};

/**
 * A modal panel attached to an edge of the screen (Base UI dialog): a title
 * row with a close button, a scrolling body, and optional actions. Focus is
 * trapped while it is open and returns to the trigger on close.
 */
export function Sheet({
  title,
  description,
  side = "right",
  size = "md",
  actions,
  open,
  onOpenChange,
  trigger,
  children,
}: SheetProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root {...openStateProps(open, onOpenChange)}>
      {trigger === undefined ? null : (
        <DialogPrimitive.Trigger render={trigger} />
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="ui-backdrop" />
        <DialogPrimitive.Popup
          className="ui-sheet"
          data-side={side}
          data-size={size}
          render={leavingPopup}
        >
          <div className="ui-sheet-head">
            <DialogPrimitive.Title className="ui-sheet-title">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="ui-icon-btn" aria-label="Close">
              <CloseIcon aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="ui-sheet-body">
            {description === undefined ? null : (
              <DialogPrimitive.Description className="ui-sheet-description">
                {description}
              </DialogPrimitive.Description>
            )}
            {children}
          </div>
          {actions === undefined ? null : (
            <div className="ui-sheet-actions">{actions}</div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Closes the surrounding `Sheet`; pass the button as `render`. */
export const SheetClose = DialogPrimitive.Close;
