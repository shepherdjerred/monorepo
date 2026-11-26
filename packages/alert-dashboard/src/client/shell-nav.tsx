import { Dialog } from "@base-ui/react/dialog";
import {
  AppSwitcher,
  CommandPaletteButton,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  type AppSwitcherEntry,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import { NavLink } from "react-router";

import { setNavDrawerOpen, useNavDrawerOpen } from "./nav-drawer.ts";
import type { ResolvedNavGroup } from "./platform/module.ts";
import { paletteStore } from "./platform/palette.tsx";
import {
  setThemePreference,
  themeStore,
  useThemePreference,
  type ThemePreference,
} from "./theme.ts";

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

type Groups = { readonly groups: readonly ResolvedNavGroup[] };

const SEARCH_LABEL = "Search and commands";
const SEARCH_SHORTCUT = "Meta+K Control+K";
const NAV_LABEL = "Primary navigation";

/** Every console, Hub first and marked current; each opens in this tab. */
const SWITCHER_APPS: readonly AppSwitcherEntry[] = CONSOLE_LINKS.map(
  (link) => ({ label: link.label, url: link.url, group: link.group }),
);
const CURRENT_APP = { label: "Hub", mark: "H" } as const;

function openPalette(): void {
  paletteStore.setOpen(true);
}

/**
 * The top bar's theme switch: an icon button that names the current theme
 * and the next. The sidebar uses the shared `ThemeRow` instead.
 */
function ThemeToggle(): React.JSX.Element {
  const preference = useThemePreference();
  const Icon = THEME_ICON[preference];
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={`Theme: ${preference}. Switch to ${NEXT_THEME[preference]}.`}
      title={`Theme: ${preference}`}
      onClick={() => {
        setThemePreference(NEXT_THEME[preference]);
      }}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

/**
 * One labelled list per group, drawn by the shared sidebar components. The
 * group names are paragraphs, not headings, so they stay out of the page's
 * heading outline. `NavLink` marks the current page with `aria-current`.
 */
function NavGroups({
  groups,
  onNavigate,
}: Groups & { readonly onNavigate?: () => void }): React.JSX.Element {
  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.label} label={group.label}>
          {group.items.map((item) => (
            <SidebarItem
              key={item.to}
              href={item.to}
              label={item.label}
              icon={item.icon}
              renderLink={({ href, ...props }) => (
                <NavLink
                  to={href}
                  end={href === "/"}
                  {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
                  {...props}
                />
              )}
            />
          ))}
        </SidebarGroup>
      ))}
    </>
  );
}

/**
 * The navigation above phone width: the app switcher and search, the grouped
 * pages, and the theme row pinned to the bottom.
 */
export function HubSidebar({ groups }: Groups): React.JSX.Element {
  return (
    <Sidebar
      label="Hub"
      navLabel={NAV_LABEL}
      top={
        <>
          <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
          <CommandPaletteButton store={paletteStore} label={SEARCH_LABEL} />
        </>
      }
      footer={<ThemeRow store={themeStore} />}
    >
      <NavGroups groups={groups} />
    </Sidebar>
  );
}

function closeDrawer(): void {
  setNavDrawerOpen(false);
}

/**
 * The navigation at phone width: a bar with the app switcher, search, and
 * theme, and a button that opens the same grouped links in a modal drawer.
 * The drawer mounts only while it is open, so the page never holds two
 * primary navigation landmarks.
 */
export function Topbar({ groups }: Groups): React.JSX.Element {
  const open = useNavDrawerOpen();
  return (
    <Dialog.Root open={open} onOpenChange={setNavDrawerOpen}>
      <header className="topbar">
        <Dialog.Trigger className="icon-button" aria-label="Open navigation">
          <MenuIcon aria-hidden="true" />
        </Dialog.Trigger>
        <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
        <button
          className="icon-button"
          type="button"
          aria-label={SEARCH_LABEL}
          aria-keyshortcuts={SEARCH_SHORTCUT}
          onClick={openPalette}
        >
          <SearchIcon aria-hidden="true" />
        </button>
        <ThemeToggle />
      </header>
      <Dialog.Portal>
        <Dialog.Backdrop className="nav-backdrop" />
        <Dialog.Popup className="nav-drawer">
          <div className="nav-drawer-head">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <span className="brand">Hub</span>
            <Dialog.Close className="icon-button" aria-label="Close navigation">
              <XIcon aria-hidden="true" />
            </Dialog.Close>
          </div>
          <nav className="ui-nav" aria-label={NAV_LABEL}>
            <NavGroups groups={groups} onNavigate={closeDrawer} />
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
