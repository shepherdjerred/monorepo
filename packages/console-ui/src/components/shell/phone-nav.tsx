import { Dialog } from "@base-ui/react/dialog";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ICONS, THEME_ICON } from "@shepherdjerred/console-ui/icons.ts";
import {
  nextThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui/theme.ts";
import { SIDEBAR_QUERY } from "@shepherdjerred/console-ui/tokens.ts";

const MenuIcon = ICONS.menu;
const CloseIcon = ICONS.close;

function subscribeToSidebarQuery(onChange: () => void): () => void {
  const query = globalThis.matchMedia(SIDEBAR_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function sidebarShows(): boolean {
  return globalThis.matchMedia(SIDEBAR_QUERY).matches;
}

/** The top bar's theme switch: names the current theme and the next. */
export function ThemeButton({
  store,
}: {
  readonly store: ThemeStore;
}): React.JSX.Element {
  const preference = store.useThemePreference();
  const next = nextThemePreference(preference);
  const Icon = THEME_ICON[preference];
  return (
    <button
      className="ui-topbar-btn"
      type="button"
      aria-label={`Theme: ${preference}. Switch to ${next}.`}
      title={`Theme: ${preference}`}
      onClick={() => {
        store.setThemePreference(next);
      }}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

export type PhoneNavProps = {
  /** Usually the `AppSwitcher`. */
  readonly switcher: ReactNode;
  /** The app's name at the top of the drawer. */
  readonly brand: string;
  /** Accessible name of the drawer's navigation landmark. */
  readonly navLabel: string;
  /** Icon buttons between the switcher and the theme toggle, e.g. search. */
  readonly actions?: ReactNode;
  readonly theme: ThemeStore;
  /** Pinned to the bottom of the drawer; call `close` when a link is followed. */
  readonly footer?: ((close: () => void) => ReactNode) | undefined;
  /** Closes the drawer while true, e.g. while the command palette is open. */
  readonly forceClosed?: boolean;
  /** The drawer's navigation groups; call `close` when a link is followed. */
  readonly children: (close: () => void) => ReactNode;
};

/**
 * The navigation below the sidebar breakpoint: a sticky bar with a menu
 * button, the app switcher, actions and the theme toggle. The menu opens the
 * navigation in a modal drawer that mounts only while open, so the page
 * never holds two primary navigation landmarks. The drawer closes when the
 * window grows past the breakpoint, where its trigger disappears.
 */
export function PhoneNav({
  switcher,
  brand,
  navLabel,
  actions,
  theme,
  footer,
  forceClosed = false,
  children,
}: PhoneNavProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const wide = useSyncExternalStore(
    subscribeToSidebarQuery,
    sidebarShows,
    () => false,
  );
  if (open && (wide || forceClosed)) setOpen(false);

  const close = (): void => {
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <header className="ui-topbar">
        <Dialog.Trigger className="ui-topbar-btn" aria-label="Open navigation">
          <MenuIcon aria-hidden="true" />
        </Dialog.Trigger>
        {switcher}
        {actions}
        <ThemeButton store={theme} />
      </header>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-drawer-backdrop" />
        <Dialog.Popup className="ui-drawer">
          <div className="ui-drawer-head">
            <Dialog.Title className="ui-sr-only">Navigation</Dialog.Title>
            <span className="ui-drawer-brand">{brand}</span>
            <Dialog.Close
              className="ui-topbar-btn"
              aria-label="Close navigation"
            >
              <CloseIcon aria-hidden="true" />
            </Dialog.Close>
          </div>
          <nav className="ui-nav" aria-label={navLabel}>
            {children(close)}
          </nav>
          {footer === undefined ? null : (
            <div className="ui-drawer-foot">{footer(close)}</div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
