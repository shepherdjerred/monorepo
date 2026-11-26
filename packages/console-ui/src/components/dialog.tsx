import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";
import { openStateProps } from "@shepherdjerred/console-ui/components/overlays/open-state.ts";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

const CloseIcon = ICONS.close;

export type DialogProps = {
  readonly title: ReactNode;
  /** Muted sentence under the title, read as the dialog's description. */
  readonly description?: ReactNode;
  /**
   * Buttons at the bottom right, primary last. Wrap a cancel button in
   * `DialogClose` so it closes the dialog and returns focus.
   */
  readonly actions: ReactNode;
  /** `sm` 400px, `md` 520px (default), `lg` 720px. */
  readonly size?: "sm" | "md" | "lg";
  /** Controlled open state; omit both to let `trigger` open it. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** An element that opens the dialog, e.g. `<Button>Delete</Button>`. */
  readonly trigger?: ReactElement;
  readonly children?: ReactNode;
};

/**
 * A modal dialog (Base UI): backdrop, a 15px title row with a close button,
 * the body, and actions. Focus is trapped while open and returns to the
 * trigger on close. Native `<dialog class="ui-dialog">` markup with the same
 * `ui-dialog-*` parts looks the same.
 */
export function Dialog({
  title,
  description,
  actions,
  size = "md",
  open,
  onOpenChange,
  trigger,
  children,
}: DialogProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root {...openStateProps(open, onOpenChange)}>
      {trigger === undefined ? null : (
        <DialogPrimitive.Trigger render={trigger} />
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="ui-backdrop" />
        <DialogPrimitive.Popup className="ui-dialog" data-size={size}>
          <div className="ui-dialog-head">
            <DialogPrimitive.Title className="ui-dialog-title">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="ui-icon-btn" aria-label="Close">
              <CloseIcon aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="ui-dialog-body">
            {description === undefined ? null : (
              <DialogPrimitive.Description className="ui-dialog-description">
                {description}
              </DialogPrimitive.Description>
            )}
            {children}
          </div>
          <div className="ui-dialog-actions">{actions}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Closes the surrounding `Dialog`; pass the button as `render`. */
export const DialogClose = DialogPrimitive.Close;
