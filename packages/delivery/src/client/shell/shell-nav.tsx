import { Dialog } from "@base-ui/react/dialog";
import {
  AppSwitcher,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  type AppSwitcherEntry,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  GitCommitHorizontalIcon,
  HistoryIcon,
  LayoutGridIcon,
  MenuIcon,
  PackageIcon,
  RocketIcon,
  ShieldCheckIcon,
  WorkflowIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useFeedStatus, type ChangeFeed } from "#client/change-feed.ts";
import { awaitsDecision } from "#client/model/view.ts";
import { queries } from "#client/queries.ts";
import { setNavDrawerOpen, useNavDrawerOpen } from "./nav-drawer.ts";
import { deliveryTheme } from "./theme.ts";

type NavDestination = {
  readonly to:
    | "/"
    | "/commits"
    | "/pipelines"
    | "/deployments"
    | "/approvals"
    | "/artifacts"
    | "/activity";
  readonly label: string;
  readonly exact: boolean;
  readonly icon: LucideIcon;
};

const NAV_GROUPS: readonly {
  readonly label: string;
  readonly items: readonly NavDestination[];
}[] = [
  {
    label: "Overview & source",
    items: [
      { to: "/", label: "Overview", exact: true, icon: LayoutGridIcon },
      {
        to: "/commits",
        label: "Commits",
        exact: false,
        icon: GitCommitHorizontalIcon,
      },
      {
        to: "/pipelines",
        label: "Pipelines",
        exact: false,
        icon: WorkflowIcon,
      },
    ],
  },
  {
    label: "Releases & audit",
    items: [
      {
        to: "/deployments",
        label: "Deployments",
        exact: false,
        icon: RocketIcon,
      },
      {
        to: "/approvals",
        label: "Approvals",
        exact: false,
        icon: ShieldCheckIcon,
      },
      { to: "/artifacts", label: "Artifacts", exact: false, icon: PackageIcon },
      { to: "/activity", label: "Activity", exact: false, icon: HistoryIcon },
    ],
  },
];

const SWITCHER_APPS: readonly AppSwitcherEntry[] = CONSOLE_LINKS.map(
  (link) => ({ label: link.label, url: link.url, group: link.group }),
);
const CURRENT_APP = { label: "Delivery", mark: "D" } as const;

function useWaitingApprovalsCount(): number {
  const approvals = useQuery(queries.approvals());
  return approvals.data?.filter((item) => awaitsDecision(item)).length ?? 0;
}

function FeedIndicator({ feed }: { readonly feed: ChangeFeed }) {
  const status = useFeedStatus(feed);
  const label = {
    connecting: "Connecting…",
    live: "Live",
    reconnecting: "Reconnecting…",
  }[status];
  return (
    <p className={`feed feed-${status}`} role="status">
      <span className="dot" aria-hidden="true" />
      {label}
    </p>
  );
}

function Identity() {
  const identity = useQuery(queries.identity());
  return (
    <p className="identity">
      {identity.data === undefined
        ? identity.error === null
          ? "Checking identity…"
          : "Authentication required"
        : identity.data.id}
    </p>
  );
}

function NavGroups({
  waitingCount,
  onNavigate,
}: {
  readonly waitingCount: number;
  readonly onNavigate?: () => void;
}) {
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label} label={group.label}>
          {group.items.map((item) => {
            const showCount = item.to === "/approvals" && waitingCount > 0;
            const Icon = item.icon;
            return (
              <SidebarItem
                key={item.to}
                href={item.to}
                label={item.label}
                icon={item.icon}
                renderLink={({ className }) => (
                  <Link
                    to={item.to}
                    activeOptions={{ exact: item.exact, includeSearch: false }}
                    className={className}
                    onClick={onNavigate}
                    // Space separates visible words so the accessible name
                    // contains the visible text (WCAG 2.5.3).
                    aria-label={
                      showCount
                        ? `${item.label}, ${String(waitingCount)} awaiting approval`
                        : undefined
                    }
                  >
                    <Icon className="ui-nav-icon" aria-hidden="true" />
                    <span className="ui-nav-text">{item.label}</span>
                    {showCount && " "}
                    {showCount && (
                      <span className="nav-count" aria-hidden="true">
                        {waitingCount}
                      </span>
                    )}
                  </Link>
                )}
              />
            );
          })}
        </SidebarGroup>
      ))}
    </>
  );
}

/** Persistent console sidebar shown above 900px. */
export function DeliverySidebar({ feed }: { readonly feed: ChangeFeed }) {
  const waitingCount = useWaitingApprovalsCount();
  return (
    <Sidebar
      label="Delivery"
      navLabel="Main"
      top={<AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />}
      footer={
        <div className="side-footer">
          <div className="side-meta">
            <FeedIndicator feed={feed} />
            <Identity />
          </div>
          <ThemeRow store={deliveryTheme} />
        </div>
      }
    >
      <NavGroups waitingCount={waitingCount} />
    </Sidebar>
  );
}

function closeDrawer(): void {
  setNavDrawerOpen(false);
}

/**
 * Sticky top bar and modal navigation drawer below 900px. The drawer mounts
 * only while open so the document never carries duplicate `Main` landmarks and
 * native `<dialog>` elements remain reserved for confirmation prompts.
 */
export function Topbar({ feed }: { readonly feed: ChangeFeed }) {
  const open = useNavDrawerOpen();
  const waitingCount = useWaitingApprovalsCount();
  return (
    <Dialog.Root open={open} onOpenChange={setNavDrawerOpen}>
      <header className="topbar">
        <Dialog.Trigger className="icon-button" aria-label="Open navigation">
          <MenuIcon aria-hidden="true" />
        </Dialog.Trigger>
        <AppSwitcher current={CURRENT_APP} apps={SWITCHER_APPS} />
        {waitingCount > 0 && (
          <Link
            to="/approvals"
            className="topbar-approvals"
            aria-label={`Approvals, ${String(waitingCount)} awaiting approval`}
          >
            Approvals{" "}
            <span className="nav-count" aria-hidden="true">
              {waitingCount}
            </span>
          </Link>
        )}
        <FeedIndicator feed={feed} />
      </header>
      <Dialog.Portal>
        <Dialog.Backdrop className="nav-backdrop" />
        <Dialog.Popup className="nav-drawer">
          <div className="nav-drawer-head">
            <Dialog.Title className="visually-hidden">Navigation</Dialog.Title>
            <span className="brand">Delivery</span>
            <Dialog.Close className="icon-button" aria-label="Close navigation">
              <XIcon aria-hidden="true" />
            </Dialog.Close>
          </div>
          <nav className="ui-nav" aria-label="Main">
            <NavGroups waitingCount={waitingCount} onNavigate={closeDrawer} />
          </nav>
          <div className="drawer-meta">
            <FeedIndicator feed={feed} />
            <Identity />
            <ThemeRow store={deliveryTheme} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
