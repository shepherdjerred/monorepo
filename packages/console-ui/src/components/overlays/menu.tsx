import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { CheckIcon, ChevronRightIcon, type LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { KeyHint } from "@shepherdjerred/console-ui/components/keyboard/key-hint.tsx";
import { ariaKeyshortcuts } from "@shepherdjerred/console-ui/components/keyboard/shortcut-keys.ts";
import { leavingPopup } from "@shepherdjerred/console-ui/components/overlays/leaving-popup.tsx";
import { openStateProps } from "@shepherdjerred/console-ui/components/overlays/open-state.ts";

/**
 * Menus and context menus share these items: Base UI's context menu is the
 * same menu opened at the pointer, so every item below works in both.
 */

export type MenuSide = "top" | "bottom" | "left" | "right";
export type MenuAlign = "start" | "center" | "end";

export type MenuProps = {
  /** The button that opens the menu, e.g. `<Button>Actions</Button>`. */
  readonly trigger: ReactElement;
  /** Names the menu when the trigger's text does not, e.g. "Actions for AI-12". */
  readonly label?: string;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly side?: MenuSide;
  readonly align?: MenuAlign;
};

type RowProps = {
  readonly icon?: LucideIcon | undefined;
  readonly children: ReactNode;
  /** A muted line under the label. */
  readonly description?: ReactNode | undefined;
};

/** Icon slot, label (and description), then whatever trails the row. */
function RowContent({
  icon,
  children,
  description,
  trailing,
}: RowProps & { readonly trailing?: ReactNode }): React.JSX.Element {
  const Icon = icon;
  return (
    <>
      {Icon === undefined ? null : (
        <Icon className="ui-menu-icon" aria-hidden="true" />
      )}
      <span className="ui-menu-text">
        <span className="ui-menu-label-text">{children}</span>
        {description === undefined ? null : (
          <span className="ui-menu-description">{description}</span>
        )}
      </span>
      {trailing}
    </>
  );
}

/** The popup body shared by menus, submenus and context menus. */
export function MenuPopupFrame({
  label,
  children,
}: {
  readonly label?: string | undefined;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <MenuPrimitive.Popup
      className="ui-menu"
      render={leavingPopup}
      {...(label === undefined ? {} : { "aria-label": label })}
    >
      {children}
    </MenuPrimitive.Popup>
  );
}

/**
 * A button that opens a menu of commands. Arrow keys move through the
 * items, typing a letter jumps to it, Enter or Space runs one, Escape
 * closes and returns focus to the trigger, ArrowRight opens a submenu.
 */
export function Menu({
  trigger,
  label,
  children,
  open,
  onOpenChange,
  side = "bottom",
  align = "start",
}: MenuProps): React.JSX.Element {
  return (
    <MenuPrimitive.Root {...openStateProps(open, onOpenChange)}>
      <MenuPrimitive.Trigger render={trigger} />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          className="ui-menu-positioner"
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
        >
          <MenuPopupFrame label={label}>{children}</MenuPopupFrame>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export type MenuItemProps = RowProps & {
  /** Runs when the item is chosen; the menu then closes. */
  readonly onSelect?: () => void;
  /** The keys that run the same command elsewhere, e.g. `"Mod+."`. */
  readonly shortcut?: string;
  /** Destructive commands read in the error ink. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** Keep the menu open after choosing, e.g. for a stepper. */
  readonly keepOpen?: boolean;
};

/** A command: icon, label, optional description and shortcut hint. */
export function MenuItem({
  icon,
  children,
  description,
  onSelect,
  shortcut,
  danger = false,
  disabled = false,
  keepOpen = false,
}: MenuItemProps): React.JSX.Element {
  return (
    <MenuPrimitive.Item
      className="ui-menu-item"
      data-danger={danger ? "" : undefined}
      disabled={disabled}
      closeOnClick={!keepOpen}
      aria-keyshortcuts={
        shortcut === undefined ? undefined : ariaKeyshortcuts(shortcut)
      }
      onClick={() => {
        onSelect?.();
      }}
    >
      <RowContent
        icon={icon}
        description={description}
        trailing={
          shortcut === undefined ? null : <KeyHint keys={shortcut} decorative />
        }
      >
        {children}
      </RowContent>
    </MenuPrimitive.Item>
  );
}

export type MenuLinkItemProps = RowProps & {
  readonly href: string;
  /** A router link to render instead of `<a>`, e.g. `<Link to="…" />`. */
  readonly render?: ReactElement;
  /** Marks the page on screen. */
  readonly current?: boolean;
};

/** A destination: still a link, so it opens in a new tab and copies as a URL. */
export function MenuLinkItem({
  href,
  render,
  current = false,
  icon,
  children,
  description,
}: MenuLinkItemProps): React.JSX.Element {
  return (
    <MenuPrimitive.LinkItem
      className="ui-menu-item"
      href={href}
      aria-current={current ? "page" : undefined}
      {...(render === undefined ? {} : { render })}
    >
      <RowContent icon={icon} description={description}>
        {children}
      </RowContent>
    </MenuPrimitive.LinkItem>
  );
}

export type MenuCheckboxItemProps = RowProps & {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
};

/** A boolean option; the menu stays open so the new state shows. */
export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  disabled = false,
  icon,
  children,
  description,
}: MenuCheckboxItemProps): React.JSX.Element {
  return (
    <MenuPrimitive.CheckboxItem
      className="ui-menu-item"
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        onCheckedChange(next);
      }}
    >
      <RowContent
        icon={icon}
        description={description}
        trailing={
          <MenuPrimitive.CheckboxItemIndicator className="ui-menu-check">
            <CheckIcon aria-hidden="true" />
          </MenuPrimitive.CheckboxItemIndicator>
        }
      >
        {children}
      </RowContent>
    </MenuPrimitive.CheckboxItem>
  );
}

export type MenuRadioGroupProps = {
  /** Names the set, e.g. "Sort by"; shown as the group's heading. */
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly children: ReactNode;
};

/** One of a set, e.g. a sort order. */
export function MenuRadioGroup({
  label,
  value,
  onValueChange,
  children,
}: MenuRadioGroupProps): React.JSX.Element {
  return (
    <MenuPrimitive.Group className="ui-menu-group">
      <MenuPrimitive.GroupLabel className="ui-menu-label">
        {label}
      </MenuPrimitive.GroupLabel>
      <MenuPrimitive.RadioGroup
        value={value}
        onValueChange={(next: unknown) => {
          if (typeof next === "string") onValueChange(next);
        }}
      >
        {children}
      </MenuPrimitive.RadioGroup>
    </MenuPrimitive.Group>
  );
}

export type MenuRadioItemProps = RowProps & {
  readonly value: string;
  readonly disabled?: boolean;
};

export function MenuRadioItem({
  value,
  disabled = false,
  icon,
  children,
  description,
}: MenuRadioItemProps): React.JSX.Element {
  return (
    <MenuPrimitive.RadioItem
      className="ui-menu-item"
      value={value}
      disabled={disabled}
      closeOnClick
    >
      <RowContent
        icon={icon}
        description={description}
        trailing={
          <MenuPrimitive.RadioItemIndicator className="ui-menu-check">
            <CheckIcon aria-hidden="true" />
          </MenuPrimitive.RadioItemIndicator>
        }
      >
        {children}
      </RowContent>
    </MenuPrimitive.RadioItem>
  );
}

export type MenuGroupProps = {
  /** A muted heading; omit for a plain group split by hairlines. */
  readonly label?: string;
  readonly children: ReactNode;
};

/** Related items; consecutive groups are split by a hairline. */
export function MenuGroup({
  label,
  children,
}: MenuGroupProps): React.JSX.Element {
  return (
    <MenuPrimitive.Group className="ui-menu-group">
      {label === undefined ? null : (
        <MenuPrimitive.GroupLabel className="ui-menu-label">
          {label}
        </MenuPrimitive.GroupLabel>
      )}
      {children}
    </MenuPrimitive.Group>
  );
}

/** A hairline between items. */
export function MenuSeparator(): React.JSX.Element {
  return <MenuPrimitive.Separator className="ui-menu-separator" />;
}

export type SubmenuProps = {
  readonly icon?: LucideIcon;
  /** The trigger row's label. */
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  /** The nested items. */
  readonly children: ReactNode;
};

/**
 * An item that opens a nested menu beside it: on hover, ArrowRight or
 * Enter; ArrowLeft or Escape closes only the submenu.
 */
export function Submenu({
  icon,
  label,
  description,
  disabled = false,
  children,
}: SubmenuProps): React.JSX.Element {
  return (
    <MenuPrimitive.SubmenuRoot>
      <MenuPrimitive.SubmenuTrigger
        className="ui-menu-item"
        disabled={disabled}
      >
        <RowContent
          icon={icon}
          description={description}
          trailing={
            <ChevronRightIcon className="ui-menu-chevron" aria-hidden="true" />
          }
        >
          {label}
        </RowContent>
      </MenuPrimitive.SubmenuTrigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          className="ui-menu-positioner"
          sideOffset={2}
          alignOffset={-5}
          collisionPadding={8}
        >
          <MenuPopupFrame>{children}</MenuPopupFrame>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.SubmenuRoot>
  );
}
