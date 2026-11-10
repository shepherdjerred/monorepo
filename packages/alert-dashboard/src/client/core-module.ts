import {
  ActivityIcon,
  BotIcon,
  BoxesIcon,
  CalendarRangeIcon,
  GaugeIcon,
  GitPullRequestIcon,
  HistoryIcon,
  ServerCogIcon,
  WrenchIcon,
} from "lucide-react";
import { lazy } from "react";

import { CORE_MODULE_ID, type ClientModule } from "./platform/module.ts";

// Each page is its own chunk so the uPlot and ops-model code only loads on the
// pages that render it.
const PromotionPage = lazy(async () => {
  const module = await import("./promotion/page.tsx");
  await import("./promotion/promotion.css");
  return { default: module.PromotionPage };
});
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
  return { default: module.DeliveryPage };
});
const MaintenancePage = lazy(async () => {
  const module = await import("./ops/section-page.tsx");
  return { default: module.MaintenancePage };
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

/**
 * Ops and the alert ledger: the pages that predate the module platform. They
 * stay in the layered `src/client` tree and keep their root-level URLs, which
 * is why this is the only module with an empty `basePath`.
 */
export const coreModule: ClientModule = {
  id: CORE_MODULE_ID,
  title: "Ops",
  icon: GaugeIcon,
  basePath: "",
  routes: [
    { path: "promotion", page: PromotionPage, chrome: "bare" },
    { path: "", page: OverviewPage },
    { path: "services", page: ServicesPage },
    { path: "services/:id", page: ServicePage },
    { path: "delivery", page: DeliveryPage },
    { path: "ai", page: AiPage },
    { path: "maintenance", page: MaintenancePage },
    { path: "review", page: ReviewPage },
    { path: "alerts", page: DashboardPage },
    { path: "alerts/:id", page: AlertDetailPage },
    { path: "history", page: HistoryPage },
    { path: "system", page: SystemPage },
  ],
  nav: [
    { label: "Overview", icon: GaugeIcon, path: "" },
    { label: "Services", icon: BoxesIcon, path: "services" },
    { label: "Delivery", icon: GitPullRequestIcon, path: "delivery" },
    { label: "AI", icon: BotIcon, path: "ai" },
    { label: "Promotion", icon: ActivityIcon, path: "promotion" },
    { label: "Maintenance", icon: WrenchIcon, path: "maintenance" },
    { label: "Review", icon: CalendarRangeIcon, path: "review" },
    { label: "Alerts", icon: ActivityIcon, path: "alerts" },
    { label: "History", icon: HistoryIcon, path: "history" },
    { label: "System", icon: ServerCogIcon, path: "system" },
  ],
};
