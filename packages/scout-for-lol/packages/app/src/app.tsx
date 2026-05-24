import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "#src/routes/login.tsx";
import { GuildPicker } from "#src/routes/guild-picker.tsx";
import { GuildSubscriptions } from "#src/routes/guild-subscriptions.tsx";
import { GuildAudit } from "#src/routes/guild-audit.tsx";
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
          <Route path="/g/:guildId" element={<GuildSubscriptions />} />
          <Route path="/g/:guildId/audit" element={<GuildAudit />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
