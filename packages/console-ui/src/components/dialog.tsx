import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
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
  /**
   * Where focus goes on close. By default the element focused when a
   * controlled dialog opened (the trigger handles itself); see Base UI's
   * `finalFocus`.
   */
  readonly finalFocus?: ComponentProps<
    typeof DialogPrimitive.Popup
  >["finalFocus"];
  readonly children?: ReactNode;
};

/**
 * A modal dialog (Base UI): backdrop, a 15px title row with a close button,
 * the body, and actions. Focus is trapped while open and returns to the
 * trigger on close; a controlled dialog returns it to the element that
 * had focus when it opened (override with `finalFocus`). Native `<dialog class="ui-dialog">` markup with the same
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
  finalFocus,
  children,
}: DialogProps): React.JSX.Element {
  const opener = useRef<Element | null>(null);
  // Remember focus before Base UI moves it into the popup. Only a controlled
  // dialog needs this: with a trigger, Base UI returns focus to the trigger.
  useLayoutEffect(() => {
    if (open === true) opener.current = document.activeElement;
  }, [open]);
  return (
    <DialogPrimitive.Root {...openStateProps(open, onOpenChange)}>
      {trigger === undefined ? null : (
        <DialogPrimitive.Trigger render={trigger} />
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="ui-backdrop" />
        <DialogPrimitive.Popup
          className="ui-dialog"
          data-size={size}
          finalFocus={
            finalFocus ??
            (() => {
              const element = opener.current;
              return element instanceof HTMLElement && element.isConnected
                ? element
                : true;
            })
          }
        >
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
