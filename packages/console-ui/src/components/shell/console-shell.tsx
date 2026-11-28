import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import {
  AppSwitcher,
  type AppSwitcherEntry,
} from "@shepherdjerred/console-ui/components/shell/app-switcher.tsx";
import {
  CommandPaletteButton,
  type CommandPaletteStore,
} from "@shepherdjerred/console-ui/components/command-palette.tsx";
import { PhoneNav } from "@shepherdjerred/console-ui/components/shell/phone-nav.tsx";
import { ShellFrame } from "@shepherdjerred/console-ui/components/shell/shell-frame.tsx";
import { Sidebar } from "@shepherdjerred/console-ui/components/shell/sidebar.tsx";
import { ThemeRow } from "@shepherdjerred/console-ui/components/shell/theme-row.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";
import type { ThemeStore } from "@shepherdjerred/console-ui/theme.ts";

const SearchIcon = ICONS.search;

export type ConsoleShellProps = {
  /** The app on screen: its name and the one-letter mark on the switcher. */
  readonly app: { readonly label: string; readonly mark: string };
  /** Every console, for the app switcher. */
  readonly apps: readonly AppSwitcherEntry[];
  /**
   * The navigation, declared once: `SidebarGroup`s of `SidebarItem`s. It is
   * drawn in the sidebar and, below the sidebar breakpoint, in the drawer,
   * which passes `close` so a followed link can shut it.
   */
  readonly nav: (close?: () => void) => ReactNode;
  /** Accessible name of the navigation landmark; defaults to "Primary". */
  readonly navLabel?: string;
  readonly theme: ThemeStore;
  /**
   * The app's command palette: adds its search button to the sidebar and
   * the top bar, and closes the drawer when the palette opens. The app
   * renders the `CommandPalette` itself.
   */
  readonly palette?: {
    readonly store: CommandPaletteStore;
    readonly label: string;
  };
  /** Above the theme row in the sidebar, and at the foot of the drawer. */
  readonly sidebarFooter?: ReactNode;
  /** Extra icon buttons in the phone top bar, before the theme switch. */
  readonly topBarActions?: ReactNode;
  /** Selector of the element the skip link focuses; defaults to `#main`. */
  readonly skipLinkTarget?: string;
  /** The page, usually a `<main id="main">` holding a `HeaderBar`. */
  readonly children: ReactNode;
};

function ignore(): void {
  // Without a palette there is nothing to unsubscribe from.
}

function subscribeToNothing(): () => void {
  return ignore;
}

function closed(): boolean {
  return false;
}

/** Focuses the target without adding the fragment to the URL and history. */
function skipTo(selector: string, event: MouseEvent<HTMLAnchorElement>): void {
  const target = globalThis.document.querySelector<HTMLElement>(selector);
  if (target === null) return;
  event.preventDefault();
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus();
}

/**
 * The whole app frame: skip link, the quiet sidebar (app switcher, palette
 * button, navigation, theme row) beside the inset panel, and below the
 * sidebar breakpoint a top bar whose drawer holds the same navigation. An
 * app cannot forget a piece, because there is only this one component.
 */
export function ConsoleShell({
  app,
  apps,
  nav,
  navLabel = "Primary",
  theme,
  palette,
  sidebarFooter,
  topBarActions,
  skipLinkTarget = "#main",
  children,
}: ConsoleShellProps): React.JSX.Element {
  const store = palette?.store;
  const paletteOpen = useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.isOpen ?? closed,
    store?.isOpen ?? closed,
  );
  const switcher = <AppSwitcher current={app} apps={apps} />;
  const paletteButton =
    palette === undefined ? null : (
      <CommandPaletteButton store={palette.store} label={palette.label} />
    );
  return (
    <>
      <a
        className="ui-skip-link"
        href={skipLinkTarget}
        onClick={(event) => {
          skipTo(skipLinkTarget, event);
        }}
      >
        Skip to content
      </a>
      <PhoneNav
        switcher={switcher}
        brand={app.label}
        navLabel={navLabel}
        theme={theme}
        forceClosed={paletteOpen}
        footer={sidebarFooter}
        actions={
          <>
            {palette === undefined ? null : (
              <button
                type="button"
                className="ui-topbar-btn"
                aria-label={palette.label}
                aria-keyshortcuts="Meta+K Control+K"
                onClick={() => {
                  palette.store.setOpen(true);
                }}
              >
                <SearchIcon aria-hidden="true" />
              </button>
            )}
            {topBarActions}
          </>
        }
      >
        {(close) => nav(close)}
      </PhoneNav>
      <ShellFrame
        sidebar={
          <Sidebar
            label={app.label}
            navLabel={navLabel}
            top={
              <>
                {switcher}
                {paletteButton}
              </>
            }
            footer={
              <>
                {sidebarFooter}
                <ThemeRow store={theme} />
              </>
            }
          >
            {nav()}
          </Sidebar>
        }
      >
        {children}
      </ShellFrame>
    </>
  );
}
