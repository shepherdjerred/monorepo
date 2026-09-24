import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

import { Shell } from "./shell.tsx";

// Each page is its own chunk so the uPlot and ops-model code only loads on the
// pages that render it.
const OverviewPage = lazy(async () => {
  const module = await import("./ops/overview-page.tsx");
  return { default: module.OverviewPage };
});
const ServicesPage = lazy(async () => {
  const module = await import("./ops/services-page.tsx");
  return { default: module.ServicesPage };
});
const ServicePage = lazy(async () => {
  const module = await import("./ops/service-page.tsx");
  return { default: module.ServicePage };
});
const DeliveryPage = lazy(async () => {
  const module = await import("./ops/section-page.tsx");
  return {
    default: () => <module.SectionPage definition={module.DELIVERY_PAGE} />,
  };
});
const MaintenancePage = lazy(async () => {
  const module = await import("./ops/section-page.tsx");
  return {
    default: () => <module.SectionPage definition={module.MAINTENANCE_PAGE} />,
  };
});
const AiPage = lazy(async () => {
  const module = await import("./ops/ai-page.tsx");
  return { default: module.AiPage };
});
const ReviewPage = lazy(async () => {
  const module = await import("./ops/review-page.tsx");
  return { default: module.ReviewPage };
});
const DashboardPage = lazy(async () => {
  const module = await import("./dashboard-page.tsx");
  return { default: module.DashboardPage };
});
const AlertDetailPage = lazy(async () => {
  const module = await import("./alert-detail-page.tsx");
  return { default: module.AlertDetailPage };
});
const HistoryPage = lazy(async () => {
  const module = await import("./history-page.tsx");
  return { default: module.HistoryPage };
});
const SystemPage = lazy(async () => {
  const module = await import("./system-page.tsx");
  return { default: module.SystemPage };
});

function page(element: React.JSX.Element): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <main>
          <div className="loading-state">Loading…</div>
        </main>
      }
    >
      {element}
    </Suspense>
  );
}

export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={page(<OverviewPage />)} />
        <Route path="services" element={page(<ServicesPage />)} />
        <Route path="services/:id" element={page(<ServicePage />)} />
        <Route path="delivery" element={page(<DeliveryPage />)} />
        <Route path="ai" element={page(<AiPage />)} />
        <Route path="maintenance" element={page(<MaintenancePage />)} />
        <Route path="review" element={page(<ReviewPage />)} />
        <Route path="alerts" element={page(<DashboardPage />)} />
        <Route path="alerts/:id" element={page(<AlertDetailPage />)} />
        <Route path="history" element={page(<HistoryPage />)} />
        <Route path="system" element={page(<SystemPage />)} />
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
