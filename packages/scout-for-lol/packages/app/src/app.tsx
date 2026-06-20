import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "#src/routes/login.tsx";
import { Installed } from "#src/routes/installed.tsx";
import { GuildPicker } from "#src/routes/guild-picker.tsx";
import { GuildSubscriptions } from "#src/routes/guild-subscriptions.tsx";
import { GuildAudit } from "#src/routes/guild-audit.tsx";
import { GuildWorkspace } from "#src/routes/guild-workspace.tsx";
import { PlayerList } from "#src/routes/player-list.tsx";
import { PlayerDetail } from "#src/routes/player-detail.tsx";
import { CompetitionList } from "#src/routes/competition-list.tsx";
import { CompetitionDetail } from "#src/routes/competition-detail.tsx";
import { CompetitionForm } from "#src/routes/competition-form.tsx";
import { ReportList } from "#src/routes/report-list.tsx";
import { ReportDetail } from "#src/routes/report-detail.tsx";
import { ReportForm } from "#src/routes/report-form.tsx";
import { AdminTools } from "#src/routes/admin-tools.tsx";
import { RequireSession } from "#src/routes/require-session.tsx";
import { ThemeToggle } from "#src/components/ui/theme-toggle.tsx";

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed right-4 top-4 z-40">
        <ThemeToggle />
      </div>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireSession />}>
          <Route path="/" element={<GuildPicker />} />
          <Route path="/installed" element={<Installed />} />
          <Route path="/g/:guildId" element={<GuildWorkspace />}>
            <Route index element={<Navigate to="subscriptions" replace />} />
            <Route path="subscriptions" element={<GuildSubscriptions />} />
            <Route path="players" element={<PlayerList />} />
            <Route path="players/:alias" element={<PlayerDetail />} />
            <Route path="competitions" element={<CompetitionList />} />
            <Route path="competitions/new" element={<CompetitionForm />} />
            <Route
              path="competitions/:competitionId"
              element={<CompetitionDetail />}
            />
            <Route
              path="competitions/:competitionId/edit"
              element={<CompetitionForm />}
            />
            <Route path="reports" element={<ReportList />} />
            <Route path="reports/new" element={<ReportForm />} />
            <Route path="reports/:reportId" element={<ReportDetail />} />
            <Route path="reports/:reportId/edit" element={<ReportForm />} />
            <Route path="admin" element={<AdminTools />} />
            <Route path="audit" element={<GuildAudit />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
