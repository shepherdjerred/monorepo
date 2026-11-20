import { Dialog } from "@base-ui/react/dialog";
import {
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import { useId } from "react";
import { Link, NavLink } from "react-router";

import { setNavDrawerOpen, useNavDrawerOpen } from "./nav-drawer.ts";
import type { ResolvedNavGroup } from "./platform/module.ts";
import { setPaletteOpen } from "./platform/palette.tsx";
import {
  setThemePreference,
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

/**
 * The theme switch. The sidebar spells the current theme out; the top bar
 * has room for the icon only.
 */
function ThemeToggle({
  iconOnly = false,
}: {
  readonly iconOnly?: boolean;
}): React.JSX.Element {
  const preference = useThemePreference();
  const Icon = THEME_ICON[preference];
  return (
    <button
      className={iconOnly ? "icon-button" : "shell-control"}
      type="button"
      aria-label={`Theme: ${preference}. Switch to ${NEXT_THEME[preference]}.`}
      title={`Theme: ${preference}`}
      onClick={() => {
        setThemePreference(NEXT_THEME[preference]);
      }}
    >
      <Icon aria-hidden="true" />
      {iconOnly ? null : <span>Theme: {preference}</span>}
    </button>
  );
}

const SEARCH_LABEL = "Search and commands";
const SEARCH_SHORTCUT = "Meta+K Control+K";

function openPalette(): void {
  setPaletteOpen(true);
}

/**
 * Opens the command palette. The ⌘K hint sits beside the button rather than
 * inside it, so the button's visible text stays part of its accessible name;
 * `aria-keyshortcuts` announces the shortcut.
 */
function SearchTrigger(): React.JSX.Element {
  return (
    <div className="search-trigger">
      <button
        className="shell-control"
        type="button"
        aria-label={SEARCH_LABEL}
        aria-keyshortcuts={SEARCH_SHORTCUT}
        onClick={openPalette}
      >
        <SearchIcon aria-hidden="true" />
        <span>Search</span>
      </button>
      <kbd aria-hidden="true">⌘K</kbd>
    </div>
  );
}

/**
 * The primary navigation: one labelled list per group. The group names are
 * paragraphs, not headings, so they stay out of the page's heading outline.
 */
function PrimaryNav({
  groups,
  onNavigate,
}: Groups & { readonly onNavigate?: () => void }): React.JSX.Element {
  const id = useId();
  return (
    <nav className="sidebar-nav" aria-label="Primary navigation">
      {groups.map((group, index) => {
        const labelId = `${id}group-${String(index)}`;
        return (
          <div key={group.label}>
            <p className="nav-group-label" id={labelId}>
              {group.label}
            </p>
            <ul aria-labelledby={labelId}>
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    className="nav-link"
                    to={item.to}
                    end={item.to === "/"}
                    {...(onNavigate === undefined
                      ? {}
                      : { onClick: onNavigate })}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** The navigation above phone width: always on screen, beside the content. */
export function Sidebar({ groups }: Groups): React.JSX.Element {
  return (
    <aside className="sidebar" aria-label="Hub">
      <Link className="brand" to="/">
        Hub
      </Link>
      <SearchTrigger />
      <PrimaryNav groups={groups} />
      <ThemeToggle />
    </aside>
  );
}

function closeDrawer(): void {
  setNavDrawerOpen(false);
}

/**
 * The navigation at phone width: a bar with the brand, search, and theme,
 * and a button that opens the same grouped links in a modal drawer. The
 * drawer mounts only while it is open, so the page never holds two primary
 * navigation landmarks.
 */
export function Topbar({ groups }: Groups): React.JSX.Element {
  const open = useNavDrawerOpen();
  return (
    <Dialog.Root open={open} onOpenChange={setNavDrawerOpen}>
      <header className="topbar">
        <Dialog.Trigger className="icon-button" aria-label="Open navigation">
          <MenuIcon aria-hidden="true" />
        </Dialog.Trigger>
        <Link className="brand" to="/">
          Hub
        </Link>
        <button
          className="icon-button"
          type="button"
          aria-label={SEARCH_LABEL}
          aria-keyshortcuts={SEARCH_SHORTCUT}
          onClick={openPalette}
        >
          <SearchIcon aria-hidden="true" />
        </button>
        <ThemeToggle iconOnly />
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
          <PrimaryNav groups={groups} onNavigate={closeDrawer} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
