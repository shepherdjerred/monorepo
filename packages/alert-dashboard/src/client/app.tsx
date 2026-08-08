import { Route, Routes } from "react-router";

import { AlertDetailPage } from "./alert-detail-page.tsx";
import { DashboardPage } from "./dashboard-page.tsx";
import { HistoryPage } from "./history-page.tsx";
import { Shell } from "./shell.tsx";
import { SystemPage } from "./system-page.tsx";

export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="alerts/:id" element={<AlertDetailPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route
          path="*"
          element={
            <main>
              <div className="empty-state">Page not found.</div>
            </main>
          }
        />
      </Route>
    </Routes>
  );
}
