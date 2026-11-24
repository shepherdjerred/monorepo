import {
  Activity,
  Compass,
  ExternalLink,
  Filter,
  Globe,
  LayoutDashboard,
  Moon,
  ShieldAlert,
  Sun,
  Swords,
  Users,
} from "lucide-react";
import {
  ServerOverviewResponseSchema,
  ViewerInfoSchema,
  type ServerOverviewResponse,
  type ViewerRole,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { useApiQuery } from "./api.ts";
import { formatInt } from "./format.ts";
import { LiveAnnouncerProvider } from "./live-announcer.tsx";
import {
  formatDocumentTitle,
  getRoutePageTitle,
  useRoute,
  type AppRoute,
} from "./router.ts";
import {
  toggleColorScheme,
  useColorScheme,
  type ColorScheme,
} from "./theme.ts";
import { StormLogoMark } from "./components/brand.tsx";
import { SpaLink } from "./components/spa-link.tsx";
import { ActivityView } from "./views/activity-view.tsx";
import { GameplayView } from "./views/gameplay-view.tsx";
import { OverviewView } from "./views/overview-view.tsx";
import { PlayerProfileView } from "./views/player-profile-view.tsx";
import { PlayersView } from "./views/players-view.tsx";
import { PvpView } from "./views/pvp-view.tsx";
import { StaffBouncesView } from "./views/staff-bounces-view.tsx";
import { StaffNetworkView } from "./views/staff-network-view.tsx";
import { StaffQueryView } from "./views/staff-query-view.tsx";

export function App() {
  return (
    <LiveAnnouncerProvider>
      <StormShell />
    </LiveAnnouncerProvider>
  );
}

function StormShell() {
  const route = useRoute();
  const theme = useColorScheme();
  const viewerQuery = useApiQuery("/api/v1/viewer", ViewerInfoSchema);

  const viewer =
    viewerQuery.state.status === "success" ? viewerQuery.state.data : undefined;
  const viewerRole: ViewerRole = viewer?.role ?? "public";
  const isStaff = viewerRole === "staff";
  const publicBlocked = viewer?.role === "public" && !viewer.publicEnabled;

  const overviewQuick = useApiQuery(
    publicBlocked ? null : "/api/v1/overview",
    ServerOverviewResponseSchema,
  );
  const liveOverview =
    overviewQuick.state.status === "success"
      ? overviewQuick.state.data
      : undefined;

  const pageTitle = formatDocumentTitle(getRoutePageTitle(route));

  return (
    <div className="storm-layout">
      <title>{pageTitle}</title>

      <StormSidebarHeader
        route={route}
        serverName={viewer?.serverName ?? "The Storm"}
        isStaff={isStaff}
        activeScheme={theme.activeScheme}
        liveOverview={liveOverview}
      />

      <div className="storm-content-col">
        <main className="storm-main">
          {publicBlocked ? (
            <PublicPausedNotice />
          ) : (
            <ActiveRouteView route={route} viewerRole={viewerRole} />
          )}
        </main>

        <footer className="storm-footer">
          <span>
            The Storm (<code>ts-mc.net</code>) · Minecraft Player &amp; Gameplay
            Analytics
          </span>
          <span>
            {isStaff
              ? "Tailnet Staff Mode Active"
              : "Public Community Telemetry"}
          </span>
        </footer>
      </div>
    </div>
  );
}

function StormSidebarHeader({
  route,
  serverName,
  isStaff,
  activeScheme,
  liveOverview,
}: {
  readonly route: AppRoute;
  readonly serverName: string;
  readonly isStaff: boolean;
  readonly activeScheme: ColorScheme;
  readonly liveOverview: ServerOverviewResponse | undefined;
}) {
  const nextThemeLabel =
    activeScheme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const isOnline = liveOverview !== undefined && liveOverview.onlineNow > 0;

  return (
    <header className="storm-sidebar">
      <a href="#page-heading" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <div className="brand-row">
        <SpaLink href="/" className="brand-link">
          <StormLogoMark size={36} />
          <span className="brand-title">
            <span className="brand-name">{serverName}</span>
            <span className="brand-subtitle">Storm Analytics</span>
          </span>
        </SpaLink>

        <button
          type="button"
          className="theme-toggle-btn"
          aria-label={nextThemeLabel}
          onClick={() => {
            toggleColorScheme();
          }}
        >
          {activeScheme === "dark" ? (
            <Sun size={17} aria-hidden="true" />
          ) : (
            <Moon size={17} aria-hidden="true" />
          )}
        </button>
      </div>

      {isStaff ? (
        <div className="staff-banner-badge">
          <ShieldAlert size={14} aria-hidden="true" />
          <span>STAFF · TAILNET</span>
        </div>
      ) : null}

      <div className="server-status-box">
        <div className="live-pill">
          <span
            className={
              isOnline ? "status-dot" : "status-dot status-dot-offline"
            }
            aria-hidden="true"
          />
          <span>
            Online:{" "}
            {liveOverview === undefined
              ? "— / 20"
              : `${formatInt(liveOverview.onlineNow)} / ${formatInt(liveOverview.maxPlayers)}`}
          </span>
        </div>
        <div className="external-links">
          <a href="https://ts-mc.net" target="_blank" rel="noopener noreferrer">
            <span>ts-mc.net</span>
            <ExternalLink size={12} aria-hidden="true" />
          </a>
          <a
            href="https://bluemap.ts-mc.net"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>BlueMap</span>
            <ExternalLink size={12} aria-hidden="true" />
          </a>
          <a
            href="https://docs.ts-mc.net"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Docs</span>
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>

      <PrimaryNavigation route={route} isStaff={isStaff} />
    </header>
  );
}

function PrimaryNavigation({
  route,
  isStaff,
}: {
  readonly route: AppRoute;
  readonly isStaff: boolean;
}) {
  const playersActive = route.kind === "players" || route.kind === "player";
  return (
    <nav aria-label="Primary">
      <div className="nav-section-label">Analytics</div>
      <ul className="nav-list">
        <li>
          <SpaLink
            href="/"
            className="nav-link"
            ariaCurrent={route.kind === "overview" ? "page" : undefined}
          >
            <LayoutDashboard size={17} aria-hidden="true" />
            <span>Server Overview</span>
          </SpaLink>
        </li>
        <li>
          <SpaLink
            href="/activity"
            className="nav-link"
            ariaCurrent={route.kind === "activity" ? "page" : undefined}
          >
            <Activity size={17} aria-hidden="true" />
            <span>Online Activity</span>
          </SpaLink>
        </li>
        <li>
          <SpaLink
            href="/players"
            className="nav-link"
            ariaCurrent={playersActive ? "page" : undefined}
          >
            <Users size={17} aria-hidden="true" />
            <span>Players</span>
          </SpaLink>
        </li>
        <li>
          <SpaLink
            href="/pvp"
            className="nav-link"
            ariaCurrent={route.kind === "pvp" ? "page" : undefined}
          >
            <Swords size={17} aria-hidden="true" />
            <span>PvP &amp; PvE</span>
          </SpaLink>
        </li>
        <li>
          <SpaLink
            href="/gameplay"
            className="nav-link"
            ariaCurrent={route.kind === "gameplay" ? "page" : undefined}
          >
            <Compass size={17} aria-hidden="true" />
            <span>Storm Gameplay</span>
          </SpaLink>
        </li>
      </ul>

      {isStaff ? <StaffNavigationSection route={route} /> : null}
    </nav>
  );
}

function StaffNavigationSection({ route }: { readonly route: AppRoute }) {
  return (
    <>
      <div className="nav-section-label" style={{ marginBlockStart: "1rem" }}>
        Staff · Tailnet
      </div>
      <ul className="nav-list">
        <li>
          <SpaLink
            href="/staff/network"
            className="nav-link"
            ariaCurrent={route.kind === "staff-network" ? "page" : undefined}
          >
            <Globe size={17} aria-hidden="true" />
            <span>Network &amp; Geo</span>
          </SpaLink>
        </li>
        <li>
          <SpaLink
            href="/staff/bounces"
            className="nav-link"
            ariaCurrent={route.kind === "staff-bounces" ? "page" : undefined}
          >
            <ShieldAlert size={17} aria-hidden="true" />
            <span>Joins &amp; Bounces</span>
          </SpaLink>
        </li>
        <li>
          <SpaLink
            href="/staff/query"
            className="nav-link"
            ariaCurrent={route.kind === "staff-query" ? "page" : undefined}
          >
            <Filter size={17} aria-hidden="true" />
            <span>Player Query</span>
          </SpaLink>
        </li>
      </ul>
    </>
  );
}

function PublicPausedNotice() {
  return (
    <div className="panel">
      <h1 id="page-heading" tabIndex={-1}>
        Public Analytics Paused
      </h1>
      <p className="page-subtitle">
        Public player statistics are currently disabled via feature flag. Staff
        members can still access full analytics over the Tailnet listener.
      </p>
    </div>
  );
}

function ActiveRouteView({
  route,
  viewerRole,
}: {
  readonly route: AppRoute;
  readonly viewerRole: ViewerRole;
}) {
  switch (route.kind) {
    case "overview":
      return <OverviewView />;
    case "activity":
      return <ActivityView />;
    case "players":
      return <PlayersView queryParams={route.query} viewerRole={viewerRole} />;
    case "player":
      return <PlayerProfileView playerId={route.id} viewerRole={viewerRole} />;
    case "pvp":
      return <PvpView />;
    case "gameplay":
      return <GameplayView />;
    case "staff-network":
      return viewerRole === "staff" ? (
        <StaffNetworkView />
      ) : (
        <StaffRestrictedNotice />
      );
    case "staff-bounces":
      return viewerRole === "staff" ? (
        <StaffBouncesView />
      ) : (
        <StaffRestrictedNotice />
      );
    case "staff-query":
      return viewerRole === "staff" ? (
        <StaffQueryView filters={route.filters} />
      ) : (
        <StaffRestrictedNotice />
      );
    case "not-found":
      return (
        <div className="panel">
          <h1 id="page-heading" tabIndex={-1}>
            Page Not Found
          </h1>
          <p className="page-subtitle">
            No Storm Analytics view exists at <code>{route.pathname}</code>.
          </p>
          <p style={{ marginBlockStart: "1rem" }}>
            <SpaLink href="/" className="btn btn-primary">
              Return to Server Overview
            </SpaLink>
          </p>
        </div>
      );
  }
}

function StaffRestrictedNotice() {
  return (
    <div className="panel">
      <h1 id="page-heading" tabIndex={-1}>
        Staff Tailnet View Restricted
      </h1>
      <p className="page-subtitle">
        This page is available exclusively on the Tailscale staff listener.
      </p>
      <p style={{ marginBlockStart: "1rem" }}>
        <SpaLink href="/" className="btn">
          Return to Public Overview
        </SpaLink>
      </p>
    </div>
  );
}
