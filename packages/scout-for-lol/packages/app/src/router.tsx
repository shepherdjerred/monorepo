import { createBrowserRouter, redirect, type RouteObject } from "react-router";
import { Login } from "#src/routes/login.tsx";
import { GuildPicker } from "#src/routes/guild-picker.tsx";
import { GuildSubscriptions } from "#src/routes/guild-subscriptions.tsx";
import { GuildAudit } from "#src/routes/guild-audit.tsx";
import { GuildAccess } from "#src/routes/guild-access.tsx";
import {
  GuildPermissionsGate,
  GuildSectionIndex,
  GuildWorkspace,
} from "#src/routes/guild-workspace.tsx";
import { PlayerList } from "#src/routes/player-list.tsx";
import { PlayerDetail } from "#src/routes/player-detail.tsx";
import { CompetitionList } from "#src/routes/competition-list.tsx";
import { CompetitionDetail } from "#src/routes/competition-detail.tsx";
import { CompetitionForm } from "#src/routes/competition-form.tsx";
import { ReportList } from "#src/routes/report-list.tsx";
import { ReportDetail } from "#src/routes/report-detail.tsx";
import { ReportForm } from "#src/routes/report-form.tsx";
import { ReportHelp } from "#src/routes/report-help.tsx";
import { OnboardingWizard } from "#src/routes/onboarding-wizard.tsx";
import { InstallLanding } from "#src/routes/install-landing.tsx";
import { RequireSession } from "#src/routes/require-session.tsx";
import { RootLayout } from "#src/routes/root-layout.tsx";
import { RouteErrorPanel } from "#src/components/route-error-panel.tsx";
import { GUILD_ACTION_ROUTE_PERMISSIONS } from "#src/lib/guild-route-permissions.ts";
import {
  accessLoader,
  auditLoader,
  competitionDetailLoader,
  competitionsLoader,
  guildLoader,
  playerDetailLoader,
  playersLoader,
  reportDetailLoader,
  reportsLoader,
  requireSessionLoader,
  subscriptionsLoader,
} from "#src/lib/route-loaders.ts";

// Each `/g/:guildId` child carries its own errorElement so a section failure
// renders inside GuildWorkspace's outlet — the workspace nav chrome survives.
const guildChildren: RouteObject[] = [
  {
    index: true,
    element: <GuildSectionIndex />,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "subscriptions",
    element: <GuildSubscriptions />,
    loader: subscriptionsLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "players",
    element: <PlayerList />,
    loader: playersLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "players/:alias",
    element: <PlayerDetail />,
    loader: playerDetailLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "competitions",
    element: <CompetitionList />,
    loader: competitionsLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "competitions/new",
    element: (
      <GuildPermissionsGate
        permissions={GUILD_ACTION_ROUTE_PERMISSIONS.competitionCreate}
      >
        <CompetitionForm />
      </GuildPermissionsGate>
    ),
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "competitions/:competitionId",
    element: <CompetitionDetail />,
    loader: competitionDetailLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "competitions/:competitionId/edit",
    element: (
      <GuildPermissionsGate
        permissions={GUILD_ACTION_ROUTE_PERMISSIONS.competitionEdit}
      >
        <CompetitionForm />
      </GuildPermissionsGate>
    ),
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "reports",
    element: <ReportList />,
    loader: reportsLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "reports/help",
    element: <ReportHelp />,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "reports/new",
    element: (
      <GuildPermissionsGate
        permissions={GUILD_ACTION_ROUTE_PERMISSIONS.reportCreate}
      >
        <ReportForm />
      </GuildPermissionsGate>
    ),
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "reports/:reportId",
    element: <ReportDetail />,
    loader: reportDetailLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "reports/:reportId/edit",
    element: (
      <GuildPermissionsGate
        permissions={GUILD_ACTION_ROUTE_PERMISSIONS.reportEdit}
      >
        <ReportForm />
      </GuildPermissionsGate>
    ),
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "audit",
    element: <GuildAudit />,
    loader: auditLoader,
    errorElement: <RouteErrorPanel />,
  },
  {
    path: "access",
    element: <GuildAccess />,
    loader: accessLoader,
    errorElement: <RouteErrorPanel />,
  },
];

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: "login", element: <Login /> },
      {
        element: <RequireSession />,
        loader: requireSessionLoader,
        errorElement: <RouteErrorPanel />,
        children: [
          { index: true, element: <GuildPicker /> },
          { path: "welcome", element: <OnboardingWizard /> },
          { path: "installed", element: <InstallLanding /> },
          {
            path: "g/:guildId",
            element: <GuildWorkspace />,
            loader: guildLoader,
            children: guildChildren,
          },
        ],
      },
      { path: "*", loader: () => redirect("/") },
    ],
  },
];

/**
 * Build the browser router. Deferred behind a function (not a module-level
 * `const`) so importing {@link routes} for `matchRoutes` unit tests doesn't
 * trigger `createBrowserRouter`, which touches `document` and would crash in a
 * non-DOM test environment. Called once from the app entry point.
 */
export function createAppRouter() {
  return createBrowserRouter(routes, { basename: "/app" });
}
