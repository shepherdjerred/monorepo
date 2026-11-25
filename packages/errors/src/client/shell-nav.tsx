import { Dialog } from "@base-ui/react/dialog";
import {
  AppSwitcher,
  IconButton,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  nextThemePreference,
  type AppSwitcherEntry,
  type SidebarLinkProps,
  type ThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  ActivityIcon,
  AlertCircleIcon,
  FolderIcon,
  FolderKeyIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SearchIcon,
  SunIcon,
  TagIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import type { ProjectSummary } from "#shared/contract.ts";
import { isPaletteShortcut, setPaletteOpen } from "./palette.tsx";
import {
  themeStore as defaultThemeStore,
  useThemePreference,
} from "./theme.ts";

const THEME_ICON: Readonly<Record<ThemePreference, LucideIcon>> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

const SEARCH_LABEL = "Search and commands";
const SEARCH_SHORTCUT = "Meta+K Control+K";
const NAV_LABEL = "Primary navigation";

const CURRENT_APP = { label: "Errors", mark: "E" } as const;

const SWITCHER_APPS: readonly AppSwitcherEntry[] = CONSOLE_LINKS.some(
  (link) => link.label === "Errors",
)
  ? CONSOLE_LINKS.map((link) => ({
      label: link.label,
      url: link.url,
      group: link.group,
    }))
  : [
      { label: "Errors", url: "/", group: "Apps" },
      ...CONSOLE_LINKS.map((link) => ({
        label: link.label,
        url: link.url,
        group: link.group,
      })),
    ];

let drawerOpen = false;
const drawerListeners = new Set<() => void>();

function subscribeDrawer(listener: () => void): () => void {
  drawerListeners.add(listener);
  return () => drawerListeners.delete(listener);
}

function getDrawerOpen(): boolean {
  return drawerOpen;
}

function getServerDrawerOpen(): boolean {
  return false;
}

export function setNavDrawerOpen(next: boolean): void {
  if (drawerOpen === next) {
    return;
  }
  drawerOpen = next;
  for (const listener of drawerListeners) {
    listener();
  }
}

export function useNavDrawerOpen(): boolean {
  return useSyncExternalStore(
    subscribeDrawer,
    getDrawerOpen,
    getServerDrawerOpen,
  );
}

if (typeof globalThis.matchMedia === "function") {
  const sidebarQuery = globalThis.matchMedia("(min-width: 901px)");
  sidebarQuery.addEventListener("change", (event) => {
    if (event.matches) {
      setNavDrawerOpen(false);
    }
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    if (isPaletteShortcut(event)) {
      setNavDrawerOpen(false);
    }
  });
}

function openPalette(): void {
  setNavDrawerOpen(false);
  setPaletteOpen(true);
}

function closeDrawer(): void {
  setNavDrawerOpen(false);
}

function TopbarIconControl({
  icon,
  label,
  title,
  keyShortcuts,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly title?: string | undefined;
  readonly keyShortcuts?: string | undefined;
  readonly onClick: () => void;
}): React.JSX.Element {
  const Icon = icon;
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      {...(title === undefined ? {} : { title })}
      {...(keyShortcuts === undefined
        ? {}
        : { "aria-keyshortcuts": keyShortcuts })}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

function ThemeToggle({
  store,
}: {
  readonly store: ThemeStore;
}): React.JSX.Element {
  const currentPref = useThemePreference(store);
  const upcomingPref = nextThemePreference(currentPref);
  return (
    <TopbarIconControl
      icon={THEME_ICON[currentPref]}
      label={`Theme: ${currentPref}. Switch to ${upcomingPref}.`}
      title={`Theme: ${currentPref}`}
      onClick={() => {
        store.setThemePreference(upcomingPref);
      }}
    />
  );
}

export type ShellNavProps = {
  readonly projects: readonly ProjectSummary[];
  readonly totalUnresolved?: number | undefined;
  readonly totalRegressed?: number | undefined;
  readonly store?: ThemeStore | undefined;
};

function RouterNavLink({
  linkProps,
  onNavigate,
}: {
  readonly linkProps: SidebarLinkProps;
  readonly onNavigate?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <Link
      to={linkProps.href}
      className={linkProps.className}
      aria-current={linkProps["aria-current"]}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
    >
      {linkProps.children}
    </Link>
  );
}

function NavGroups({
  projects,
  totalUnresolved,
  totalRegressed,
  onNavigate,
}: {
  readonly projects: readonly ProjectSummary[];
  readonly totalUnresolved?: number | undefined;
  readonly totalRegressed?: number | undefined;
  readonly onNavigate?: (() => void) | undefined;
}): React.JSX.Element {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const tab = searchParams.get("tab");

  const isOverview = location.pathname === "/";
  const isRegressed = location.pathname === "/issues" && tab === "regressed";
  const isUnresolved =
    (location.pathname === "/issues" && tab !== "regressed") ||
    location.pathname.startsWith("/issues/");
  const isReleases = location.pathname.startsWith("/releases");
  const isProjectsDirectory = location.pathname === "/projects";

  return (
    <>
      <SidebarGroup label="Triage">
        <SidebarItem
          href="/"
          label="Overview"
          icon={ActivityIcon}
          current={isOverview}
          renderLink={(linkProps) => (
            <RouterNavLink linkProps={linkProps} onNavigate={onNavigate} />
          )}
        />
        <SidebarItem
          href="/issues"
          label="Unresolved"
          icon={AlertCircleIcon}
          {...(totalUnresolved === undefined ? {} : { count: totalUnresolved })}
          current={isUnresolved}
          renderLink={(linkProps) => (
            <RouterNavLink linkProps={linkProps} onNavigate={onNavigate} />
          )}
        />
        <SidebarItem
          href="/issues?tab=regressed"
          label="Regressed"
          icon={RotateCcwIcon}
          {...(totalRegressed !== undefined && totalRegressed > 0
            ? { count: totalRegressed }
            : {})}
          current={isRegressed}
          renderLink={(linkProps) => (
            <RouterNavLink linkProps={linkProps} onNavigate={onNavigate} />
          )}
        />
        <SidebarItem
          href="/releases"
          label="Releases"
          icon={TagIcon}
          current={isReleases}
          renderLink={(linkProps) => (
            <RouterNavLink linkProps={linkProps} onNavigate={onNavigate} />
          )}
        />
        <SidebarItem
          href="/projects"
          label="Projects & DSNs"
          icon={FolderKeyIcon}
          current={isProjectsDirectory}
          renderLink={(linkProps) => (
            <RouterNavLink linkProps={linkProps} onNavigate={onNavigate} />
          )}
        />
      </SidebarGroup>
      <SidebarGroup label="Projects">
        {projects.map((project) => {
          const projectHref = `/projects/${encodeURIComponent(project.slug)}`;
          return (
            <SidebarItem
              key={project.id}
              href={projectHref}
              label={project.name}
              icon={FolderIcon}
              count={project.unresolvedCount}
              current={location.pathname === projectHref}
              renderLink={(linkProps) => (
                <RouterNavLink linkProps={linkProps} onNavigate={onNavigate} />
              )}
            />
          );
        })}
      </SidebarGroup>
    </>
  );
}

export function ErrorsSidebar({
  projects,
  totalUnresolved,
  totalRegressed,
  store = defaultThemeStore,
}: ShellNavProps): React.JSX.Element {
  return (
    <Sidebar
      label="Errors"
      navLabel={NAV_LABEL}
      top={
        <>
          <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
          <IconButton
            icon={SearchIcon}
            label={SEARCH_LABEL}
            aria-keyshortcuts={SEARCH_SHORTCUT}
            title="Search (⌘K)"
            onClick={openPalette}
          />
        </>
      }
      footer={<ThemeRow store={store} />}
    >
      <NavGroups
        projects={projects}
        totalUnresolved={totalUnresolved}
        totalRegressed={totalRegressed}
      />
    </Sidebar>
  );
}

function TopbarHeaderBar({
  store,
}: {
  readonly store: ThemeStore;
}): React.JSX.Element {
  return (
    <header className="topbar">
      <Dialog.Trigger className="icon-button" aria-label="Open navigation">
        <MenuIcon aria-hidden="true" />
      </Dialog.Trigger>
      <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
      <TopbarIconControl
        icon={SearchIcon}
        label={SEARCH_LABEL}
        keyShortcuts={SEARCH_SHORTCUT}
        onClick={openPalette}
      />
      <ThemeToggle store={store} />
    </header>
  );
}

export function Topbar({
  projects,
  totalUnresolved,
  totalRegressed,
  store = defaultThemeStore,
}: ShellNavProps): React.JSX.Element {
  const drawerVisible = useNavDrawerOpen();
  return (
    <Dialog.Root open={drawerVisible} onOpenChange={setNavDrawerOpen}>
      <TopbarHeaderBar store={store} />
      <Dialog.Portal>
        <Dialog.Backdrop className="nav-backdrop" />
        <Dialog.Popup className="nav-drawer">
          <div className="nav-drawer-head">
            <Dialog.Title className="ui-sr-only">Navigation</Dialog.Title>
            <span className="er-brand">Errors</span>
            <Dialog.Close className="icon-button" aria-label="Close navigation">
              <XIcon aria-hidden="true" />
            </Dialog.Close>
          </div>
          <nav className="ui-nav" aria-label={NAV_LABEL}>
            <NavGroups
              projects={projects}
              totalUnresolved={totalUnresolved}
              totalRegressed={totalRegressed}
              onNavigate={closeDrawer}
            />
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
