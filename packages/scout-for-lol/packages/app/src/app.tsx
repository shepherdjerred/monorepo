import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { normalizePath, trackPageview } from "#src/lib/analytics.ts";
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
import {
  ContractMismatchBanner,
  VersionFooter,
} from "#src/components/version-info.tsx";
import { GUILD_ACTION_ROUTE_PERMISSIONS } from "#src/lib/guild-route-permissions.ts";

export function App() {
  const location = useLocation();
  // Report a templated pageview on every route change (no-op unless analytics
  // is configured — prod/beta only). Dynamic segments are collapsed so pages
  // group by shape, not by guild/report/player id.
  useEffect(() => {
    trackPageview(normalizePath(location.pathname));
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <ContractMismatchBanner />
      <div className="flex-1">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireSession />}>
            <Route path="/" element={<GuildPicker />} />
            <Route path="/welcome" element={<OnboardingWizard />} />
            <Route path="/installed" element={<InstallLanding />} />
            <Route path="/g/:guildId" element={<GuildWorkspace />}>
              <Route index element={<GuildSectionIndex />} />
              <Route path="subscriptions" element={<GuildSubscriptions />} />
              <Route path="players" element={<PlayerList />} />
              <Route path="players/:alias" element={<PlayerDetail />} />
              <Route path="competitions" element={<CompetitionList />} />
              <Route
                path="competitions/new"
                element={
                  <GuildPermissionsGate
                    permissions={
                      GUILD_ACTION_ROUTE_PERMISSIONS.competitionCreate
                    }
                  >
                    <CompetitionForm />
                  </GuildPermissionsGate>
                }
              />
              <Route
                path="competitions/:competitionId"
                element={<CompetitionDetail />}
              />
              <Route
                path="competitions/:competitionId/edit"
                element={
                  <GuildPermissionsGate
                    permissions={GUILD_ACTION_ROUTE_PERMISSIONS.competitionEdit}
                  >
                    <CompetitionForm />
                  </GuildPermissionsGate>
                }
              />
              <Route path="reports" element={<ReportList />} />
              <Route path="reports/help" element={<ReportHelp />} />
              <Route
                path="reports/new"
                element={
                  <GuildPermissionsGate
                    permissions={GUILD_ACTION_ROUTE_PERMISSIONS.reportCreate}
                  >
                    <ReportForm />
                  </GuildPermissionsGate>
                }
              />
              <Route path="reports/:reportId" element={<ReportDetail />} />
              <Route
                path="reports/:reportId/edit"
                element={
                  <GuildPermissionsGate
                    permissions={GUILD_ACTION_ROUTE_PERMISSIONS.reportEdit}
                  >
                    <ReportForm />
                  </GuildPermissionsGate>
                }
              />
              <Route path="audit" element={<GuildAudit />} />
              <Route path="access" element={<GuildAccess />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <VersionFooter />
    </div>
  );
}
