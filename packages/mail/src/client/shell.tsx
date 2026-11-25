import { Dialog } from "@base-ui/react/dialog";
import {
  AppSwitcher,
  IconButton,
  nextThemePreference,
  ShellFrame,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  type AppSwitcherEntry,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import type { AdminOverviewResponse } from "@shepherdjerred/mail/shared/contract.ts";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  ActivityIcon,
  BellIcon,
  BugIcon,
  CircleAlertIcon,
  ClockIcon,
  FilmIcon,
  InboxIcon,
  MenuIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SendIcon,
  SunIcon,
  TvIcon,
  WorkflowIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";

import { useAdminOverview } from "./api.ts";
import {
  formatSenderCount,
  parseOutboxFilter,
  type OutboxFilter,
  type StatusFilter,
} from "./format.ts";
import {
  focusSearchOrQueue,
  isSlashSearchShortcut,
  setNavDrawerOpen,
  useNavDrawerOpen,
} from "./nav-state.ts";
import { themeStore } from "./theme.ts";

export const CURRENT_APP = { label: "Mail", mark: "M" } as const;

export const SWITCHER_APPS: readonly AppSwitcherEntry[] = CONSOLE_LINKS.map(
  (link) => ({
    label: link.label,
    url: link.url,
    group: link.group,
  }),
);

/**
 * `Sidebar` renders `<nav aria-label={navLabel}>`. Keep `"navigation"` out of
 * `navLabel` so assistive technology announces `"Primary, navigation"` rather
 * than `"Primary navigation, navigation"`.
 */
const PRIMARY_NAV_LABEL = "Primary";
const SEARCH_LABEL = "Search outbox";

const THEME_ICON = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
} as const;

type OutboxNavSpec = {
  readonly label: string;
  readonly href: string;
  readonly status: StatusFilter | undefined;
  readonly icon: LucideIcon;
  readonly count?: (overview: AdminOverviewResponse) => number | undefined;
};

type SenderNavSpec = {
  readonly clientId: string;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
};

const OUTBOX_ITEMS: readonly OutboxNavSpec[] = [
  {
    label: "All messages",
    href: "/",
    status: undefined,
    icon: InboxIcon,
  },
  {
    label: "Queued & retrying",
    href: "/?status=active",
    status: "active",
    icon: ClockIcon,
    count: (overview) =>
      overview.counts.active > 0 ? overview.counts.active : undefined,
  },
  {
    label: "Sent",
    href: "/?status=sent",
    status: "sent",
    icon: SendIcon,
  },
  {
    label: "Failed",
    href: "/?status=failed",
    status: "failed",
    icon: CircleAlertIcon,
    count: (overview) =>
      overview.counts.failed > 0 ? overview.counts.failed : undefined,
  },
];

export const SENDER_ITEMS: readonly SenderNavSpec[] = [
  {
    clientId: "alert-dashboard",
    label: "Hub",
    href: "/?client=alert-dashboard",
    icon: ActivityIcon,
  },
  {
    clientId: "media",
    label: "Media",
    href: "/?client=media",
    icon: FilmIcon,
  },
  {
    clientId: "temporal",
    label: "Temporal",
    href: "/?client=temporal",
    icon: WorkflowIcon,
  },
  {
    clientId: "alertmanager",
    label: "Alertmanager",
    href: "/?client=alertmanager",
    icon: BellIcon,
  },
  {
    clientId: "storm-forum-prod",
    label: "Storm Forum",
    href: "/?client=storm-forum-prod",
    icon: MessageSquareIcon,
  },
  {
    clientId: "bugsink",
    label: "Bugsink",
    href: "/?client=bugsink",
    icon: BugIcon,
  },
  {
    clientId: "seerr",
    label: "Seerr",
    href: "/?client=seerr",
    icon: TvIcon,
  },
];

export function isOutboxItemCurrent(
  pathname: string,
  filter: OutboxFilter,
  targetStatus: StatusFilter | undefined,
): boolean {
  return (
    pathname === "/" &&
    filter.client === undefined &&
    filter.status === targetStatus
  );
}

export function isSenderItemCurrent(
  pathname: string,
  filter: OutboxFilter,
  clientId: string,
): boolean {
  return (
    pathname === "/" &&
    filter.status === undefined &&
    filter.client === clientId
  );
}

function TopbarThemeToggle({
  store,
}: {
  readonly store: ThemeStore;
}): React.JSX.Element {
  const preference = store.useThemePreference();
  const next = nextThemePreference(preference);
  const Icon = THEME_ICON[preference];
  return (
    <button
      className="icon-button"
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

function MailNavGroups({
  pathname,
  filter,
  overview,
  onNavigate,
}: {
  readonly pathname: string;
  readonly filter: OutboxFilter;
  readonly overview: AdminOverviewResponse | undefined;
  readonly onNavigate?: () => void;
}): React.JSX.Element {
  const statsByClient = useMemo(() => {
    const map = new Map<string, AdminOverviewResponse["clients"][number]>();
    if (overview !== undefined) {
      for (const client of overview.clients) {
        map.set(client.clientId, client);
      }
    }
    return map;
  }, [overview]);

  const renderNavLink = useCallback<
    NonNullable<ComponentProps<typeof SidebarItem>["renderLink"]>
  >(
    ({ href, className, "aria-current": ariaCurrent, children }) => (
      <Link
        to={href}
        className={className}
        aria-current={ariaCurrent}
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      >
        {children}
      </Link>
    ),
    [onNavigate],
  );

  return (
    <>
      <SidebarGroup label="Outbox">
        {OUTBOX_ITEMS.map((item) => {
          const count =
            overview === undefined || item.count === undefined
              ? undefined
              : item.count(overview);
          return (
            <SidebarItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              current={isOutboxItemCurrent(pathname, filter, item.status)}
              {...(count === undefined ? {} : { count })}
              renderLink={renderNavLink}
            />
          );
        })}
      </SidebarGroup>
      <SidebarGroup label="Senders">
        {SENDER_ITEMS.map((sender) => {
          const count = formatSenderCount(statsByClient.get(sender.clientId));
          return (
            <SidebarItem
              key={sender.clientId}
              href={sender.href}
              label={sender.label}
              icon={sender.icon}
              current={isSenderItemCurrent(pathname, filter, sender.clientId)}
              {...(count === undefined ? {} : { count })}
              renderLink={renderNavLink}
            />
          );
        })}
      </SidebarGroup>
    </>
  );
}

export function MailSidebar({
  pathname,
  filter,
  overview,
  theme = themeStore,
  onSearch,
}: {
  readonly pathname: string;
  readonly filter: OutboxFilter;
  readonly overview: AdminOverviewResponse | undefined;
  readonly theme?: ThemeStore;
  readonly onSearch: () => void;
}): React.JSX.Element {
  return (
    <Sidebar
      label="Mail"
      navLabel={PRIMARY_NAV_LABEL}
      top={
        <>
          <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
          <IconButton
            icon={SearchIcon}
            label={SEARCH_LABEL}
            title="Search (/)"
            aria-keyshortcuts="/"
            onClick={onSearch}
          />
        </>
      }
      footer={<ThemeRow store={theme} />}
    >
      <MailNavGroups pathname={pathname} filter={filter} overview={overview} />
    </Sidebar>
  );
}

export function MailTopbar({
  pathname,
  filter,
  overview,
  theme = themeStore,
  onSearch,
}: {
  readonly pathname: string;
  readonly filter: OutboxFilter;
  readonly overview: AdminOverviewResponse | undefined;
  readonly theme?: ThemeStore;
  readonly onSearch: () => void;
}): React.JSX.Element {
  const open = useNavDrawerOpen();
  return (
    <Dialog.Root open={open} onOpenChange={setNavDrawerOpen}>
      <header className="topbar">
        <Dialog.Trigger className="icon-button" aria-label="Open menu">
          <MenuIcon aria-hidden="true" />
        </Dialog.Trigger>
        <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
        <button
          className="icon-button"
          type="button"
          aria-label={SEARCH_LABEL}
          title="Search (/)"
          aria-keyshortcuts="/"
          onClick={onSearch}
        >
          <SearchIcon aria-hidden="true" />
        </button>
        <TopbarThemeToggle store={theme} />
      </header>
      {open ? (
        <Dialog.Portal>
          <Dialog.Backdrop className="nav-backdrop" />
          <Dialog.Popup className="nav-drawer">
            <div className="nav-drawer-head">
              <Dialog.Title className="ui-sr-only">Mail menu</Dialog.Title>
              <span className="brand">Mail</span>
              <Dialog.Close className="icon-button" aria-label="Close menu">
                <XIcon aria-hidden="true" />
              </Dialog.Close>
            </div>
            <nav className="ui-nav" aria-label={PRIMARY_NAV_LABEL}>
              <MailNavGroups
                pathname={pathname}
                filter={filter}
                overview={overview}
                onNavigate={() => {
                  setNavDrawerOpen(false);
                }}
              />
            </nav>
          </Dialog.Popup>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}

export function MailShell({
  theme = themeStore,
}: {
  readonly theme?: ThemeStore;
}): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filter = useMemo(() => parseOutboxFilter(searchParams), [searchParams]);
  const overviewQuery = useAdminOverview();

  const triggerSearch = (): void => {
    setNavDrawerOpen(false);
    const focused = focusSearchOrQueue();
    if (!focused && location.pathname !== "/") {
      void navigate("/");
    }
  };

  const handleShellKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void => {
    if (
      !isSlashSearchShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
        target: event.target,
      })
    ) {
      return;
    }
    event.preventDefault();
    triggerSearch();
  };

  return (
    <div className="mail-root" onKeyDownCapture={handleShellKeyDown}>
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <MailTopbar
        pathname={location.pathname}
        filter={filter}
        overview={overviewQuery.data}
        theme={theme}
        onSearch={triggerSearch}
      />
      <ShellFrame
        sidebar={
          <MailSidebar
            pathname={location.pathname}
            filter={filter}
            overview={overviewQuery.data}
            theme={theme}
            onSearch={triggerSearch}
          />
        }
      >
        <div
          className="app-content"
          id="content"
          ref={contentRef}
          tabIndex={-1}
        >
          <Outlet />
        </div>
      </ShellFrame>
    </div>
  );
}
