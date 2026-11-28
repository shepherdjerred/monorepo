import { Menu } from "@base-ui/react/menu";
import { AppSwitcher } from "@shepherdjerred/console-ui";
import { ThemeButton } from "@shepherdjerred/console-ui/components/shell/phone-nav.tsx";
import { KeyboardIcon, MoreHorizontalIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { CURRENT_APP, SWITCHER_APPS } from "./app-nav.ts";
import { useShell } from "./shell-context.tsx";
import { themeStore } from "./theme.ts";

export type NavMenuItem = {
  readonly key: string;
  readonly label: string;
  /** An in-app route; the menu navigates to it. */
  readonly to?: string;
  readonly onSelect?: () => void;
};

/**
 * The shell's top bar and the page's own header as one floating pill at the
 * top left: the workspace switcher and Inbox the bar had, then the page's
 * title and actions, then the keyboard and theme buttons. On a phone it keeps
 * the app mark and the title and moves the rest into an overflow menu.
 */
export function FloatingNav({
  lead,
  actions,
  menu,
}: {
  /** The page's title (and crumbs): the one place a heading lives. */
  readonly lead: React.ReactNode;
  /** Page actions shown inline: List view, the version select, Open raw. */
  readonly actions?: React.ReactNode;
  /** The same actions as overflow menu items for a narrow screen. */
  readonly menu: readonly NavMenuItem[];
}): React.JSX.Element {
  const { openShortcuts } = useShell();
  const navigate = useNavigate();
  return (
    <div className="ar-fnav" data-testid="floating-nav">
      <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
      <nav aria-label="Primary" className="ar-fnav-links">
        <Link to="/">Inbox</Link>
      </nav>
      <span className="ar-fnav-sep" aria-hidden="true" />
      <div className="ar-fnav-lead">{lead}</div>
      {actions === undefined ? null : (
        <div className="ar-fnav-actions">{actions}</div>
      )}
      <span className="ar-fnav-sep ar-fnav-end" aria-hidden="true" />
      <button
        type="button"
        className="ar-icon-button ar-fnav-end"
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts="?"
        title="Keyboard shortcuts (?)"
        onClick={openShortcuts}
      >
        <KeyboardIcon aria-hidden="true" />
      </button>
      <span className="ar-fnav-end">
        <ThemeButton store={themeStore} />
      </span>
      <Menu.Root>
        <Menu.Trigger className="ar-icon-button ar-fnav-more" aria-label="More">
          <MoreHorizontalIcon aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="ui-menu-positioner" sideOffset={4}>
            <Menu.Popup className="ui-menu">
              <Menu.Item
                className="ui-menu-item"
                onClick={() => {
                  void navigate("/");
                }}
              >
                Inbox
              </Menu.Item>
              {menu.map((item) => (
                <Menu.Item
                  key={item.key}
                  className="ui-menu-item"
                  onClick={() => {
                    if (item.to !== undefined) void navigate(item.to);
                    item.onSelect?.();
                  }}
                >
                  {item.label}
                </Menu.Item>
              ))}
              <Menu.Item className="ui-menu-item" onClick={openShortcuts}>
                Keyboard shortcuts
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
