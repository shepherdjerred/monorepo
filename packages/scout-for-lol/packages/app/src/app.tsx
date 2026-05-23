import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "#src/routes/login.tsx";
import { GuildPicker } from "#src/routes/guild-picker.tsx";
import { GuildSubscriptions } from "#src/routes/guild-subscriptions.tsx";
import { GuildAudit } from "#src/routes/guild-audit.tsx";
import { RequireSession } from "#src/routes/require-session.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireSession />}>
        <Route path="/" element={<GuildPicker />} />
        <Route path="/g/:guildId" element={<GuildSubscriptions />} />
        <Route path="/g/:guildId/audit" element={<GuildAudit />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
