import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";
import { leavingPopup } from "@shepherdjerred/console-ui/components/overlays/leaving-popup.tsx";
import { openStateProps } from "@shepherdjerred/console-ui/components/overlays/open-state.ts";

export type PopoverProps = {
  /** The button that opens the panel, e.g. `<Button>Display</Button>`. */
  readonly trigger: ReactElement;
  /** A 13px heading at the top of the panel; it also names the panel. */
  readonly title?: ReactNode;
  /** Names the panel when it has no `title`. */
  readonly label?: string;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly align?: "start" | "center" | "end";
  /** `sm` 240px, `md` 320px (default), `lg` 400px; never wider than the screen. */
  readonly size?: "sm" | "md" | "lg";
};

/**
 * An anchored panel for a few controls: filters, display options, a date.
 * It has no arrow; it closes on Escape or a click outside and returns focus
 * to its trigger. For commands use `Menu`; for a task use `Dialog`.
 */
export function Popover({
  trigger,
  title,
  label,
  children,
  open,
  onOpenChange,
  side = "bottom",
  align = "start",
  size = "md",
}: PopoverProps): React.JSX.Element {
  return (
    <PopoverPrimitive.Root {...openStateProps(open, onOpenChange)}>
      <PopoverPrimitive.Trigger render={trigger} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          className="ui-menu-positioner"
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
        >
          <PopoverPrimitive.Popup
            className="ui-popover"
            data-size={size}
            render={leavingPopup}
            {...(title === undefined && label !== undefined
              ? { "aria-label": label }
              : {})}
          >
            {title === undefined ? null : (
              <PopoverPrimitive.Title className="ui-popover-title">
                {title}
              </PopoverPrimitive.Title>
            )}
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Closes the surrounding `Popover`; pass the button as `render`. */
export const PopoverClose = PopoverPrimitive.Close;
