import { CommandIcon, LinkIcon, SearchIcon } from "lucide-react";
import {
  AppSwitcher,
  IconButton,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  TopBar,
  type SidebarLinkProps,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";

const SWITCHER_CURRENT = { label: "Go links", mark: "G" } as const;
const SWITCHER_APPS = CONSOLE_LINKS.map(({ label, url, group }) => ({
  label,
  url,
  group,
}));
const NAV_LABEL = "Go links";
const SEARCH_LABEL = "Search links";

function Switcher() {
  return <AppSwitcher current={SWITCHER_CURRENT} apps={SWITCHER_APPS} />;
}

type DirectoryNavProps = {
  linkCount: number;
  shortcutCount: number;
};

/** The page's sections, as in-page links. */
function DirectoryNav({
  linkCount,
  shortcutCount,
  onNavigate,
}: DirectoryNavProps & { onNavigate?: () => void }) {
  const renderLink =
    onNavigate === undefined
      ? undefined
      : ({
          href,
          className,
          "aria-current": ariaCurrent,
          children,
        }: SidebarLinkProps) => (
          <a
            href={href}
            className={className}
            aria-current={ariaCurrent}
            onClick={onNavigate}
          >
            {children}
          </a>
        );
  return (
    <SidebarGroup label="Directory">
      <SidebarItem
        href="#links"
        label="Links"
        icon={LinkIcon}
        count={linkCount}
        current
        {...(renderLink === undefined ? {} : { renderLink })}
      />
      {shortcutCount > 0 && (
        <SidebarItem
          href="#shortcuts"
          label="Shortcuts"
          icon={CommandIcon}
          count={shortcutCount}
          {...(renderLink === undefined ? {} : { renderLink })}
        />
      )}
    </SidebarGroup>
  );
}

/** The navigation above phone width: switcher and search, sections, theme. */
export function GolinkSidebar({
  linkCount,
  shortcutCount,
  theme,
  onSearch,
}: DirectoryNavProps & { theme: ThemeStore; onSearch: () => void }) {
  return (
    <Sidebar
      label="Go links"
      navLabel={NAV_LABEL}
      top={
        <>
          <Switcher />
          <IconButton
            icon={SearchIcon}
            label={SEARCH_LABEL}
            aria-keyshortcuts="/"
            title="Search (/)"
            onClick={onSearch}
          />
        </>
      }
      footer={<ThemeRow store={theme} />}
    >
      <DirectoryNav linkCount={linkCount} shortcutCount={shortcutCount} />
    </Sidebar>
  );
}

/** The navigation at phone width: the shared top bar and drawer. */
export function GolinkTopBar({
  linkCount,
  shortcutCount,
  theme,
  onSearch,
}: DirectoryNavProps & { theme: ThemeStore; onSearch: () => void }) {
  return (
    <TopBar
      switcher={<Switcher />}
      brand="Go links"
      navLabel={NAV_LABEL}
      theme={theme}
      actions={
        <button
          className="ui-topbar-btn"
          type="button"
          aria-label={SEARCH_LABEL}
          aria-keyshortcuts="/"
          onClick={onSearch}
        >
          <SearchIcon aria-hidden="true" />
        </button>
      }
    >
      {(close) => (
        <DirectoryNav
          linkCount={linkCount}
          shortcutCount={shortcutCount}
          onNavigate={close}
        />
      )}
    </TopBar>
  );
}
