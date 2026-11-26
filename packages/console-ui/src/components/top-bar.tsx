import { Dialog } from "@base-ui/react/dialog";
import { MenuIcon, MonitorIcon, MoonIcon, SunIcon, XIcon } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  nextThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui/theme.ts";

const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/** Matches the shell: the sidebar shows above this width, the top bar below. */
const SIDEBAR_QUERY = "(min-width: 901px)";

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
export function ThemeToggle({
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

export type TopBarProps = {
  /** Usually the `AppSwitcher`. */
  readonly switcher: ReactNode;
  /** The app's name at the top of the drawer. */
  readonly brand: string;
  /** Accessible name of the drawer's navigation landmark. */
  readonly navLabel: string;
  /** Icon buttons between the switcher and the theme toggle, e.g. search. */
  readonly actions?: ReactNode;
  readonly theme: ThemeStore;
  /** The drawer's navigation groups; call `close` when a link is followed. */
  readonly children: (close: () => void) => ReactNode;
};

/**
 * The navigation at phone width: a sticky bar with a menu button, the app
 * switcher, actions and the theme toggle. The menu opens the navigation in a
 * modal drawer that mounts only while open, so the page never holds two
 * primary navigation landmarks. Hidden above 900px, where the sidebar shows.
 */
export function TopBar({
  switcher,
  brand,
  navLabel,
  actions,
  theme,
  children,
}: TopBarProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const wide = useSyncExternalStore(
    subscribeToSidebarQuery,
    sidebarShows,
    () => false,
  );
  // The trigger disappears with the bar, so a drawer left open while the
  // window grows past phone width would have nothing to return focus to.
  if (wide && open) setOpen(false);

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
        <ThemeToggle store={theme} />
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
              <XIcon aria-hidden="true" />
            </Dialog.Close>
          </div>
          <nav className="ui-nav" aria-label={navLabel}>
            {children(close)}
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
