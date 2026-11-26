import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { MenuPopupFrame } from "@shepherdjerred/console-ui/components/overlays/menu.tsx";

export type ContextMenuProps = {
  /** Names the menu, e.g. "Actions for AI-12". */
  readonly label: string;
  /** The menu's items: `MenuItem`, `Submenu`, `MenuCheckboxItem`, … */
  readonly menu: ReactNode;
  /** The target that right-click, long press or Shift+F10 opens it on. */
  readonly children: ReactNode;
  /** The target element to render instead of a `div`, e.g. `<tr />`. */
  readonly render?: ReactElement;
  readonly className?: string;
  readonly onOpenChange?: (open: boolean) => void;
  readonly disabled?: boolean;
};

/** Whether a key press asks for the context menu: Shift+F10 or the Menu key. */
export function isContextMenuKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
): boolean {
  return (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu";
}

/**
 * Opens the menu from the keyboard where the focused element is, rather
 * than where the browser's keyboard `contextmenu` event says (often the
 * corner of the page).
 */
function openFromKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if (!isContextMenuKey(event)) return;
  event.preventDefault();
  const source =
    event.target instanceof HTMLElement ? event.target : event.currentTarget;
  const rect = source.getBoundingClientRect();
  source.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(16, rect.width / 2),
      clientY: rect.top + Math.min(rect.height, 28),
    }),
  );
}

/**
 * A menu on a target, opened at the pointer by right-click or long press,
 * or by Shift+F10 or the Menu key on the focused element. Its items are the
 * same as `Menu`'s. Away from the target the browser keeps its own menu.
 */
export function ContextMenu({
  label,
  menu,
  children,
  render,
  className,
  onOpenChange,
  disabled = false,
}: ContextMenuProps): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Root
      disabled={disabled}
      {...(onOpenChange === undefined
        ? {}
        : {
            onOpenChange: (next: boolean) => {
              onOpenChange(next);
            },
          })}
    >
      <ContextMenuPrimitive.Trigger
        className={className}
        onKeyDown={openFromKeyboard}
        {...(render === undefined ? {} : { render })}
      >
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Positioner
          className="ui-menu-positioner"
          collisionPadding={8}
        >
          <MenuPopupFrame label={label}>{menu}</MenuPopupFrame>
        </ContextMenuPrimitive.Positioner>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
