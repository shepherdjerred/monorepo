import {
  ActivityIcon,
  HouseIcon,
  BotIcon,
  BoxesIcon,
  CalendarRangeIcon,
  GaugeIcon,
  GitPullRequestIcon,
  HistoryIcon,
  MegaphoneIcon,
  ServerCogIcon,
  WrenchIcon,
} from "lucide-react";
import { lazy } from "react";

import { coreCommands, coreSearch } from "./core-palette.ts";
import { CORE_MODULE_ID, type ClientModule } from "./platform/module.ts";
import { DeliveryRedirect, OverviewRedirect } from "./redirects.tsx";

// Each page is its own chunk so the uPlot and ops-model code only loads on the
// pages that render it.
const PromotionPage = lazy(async () => {
  const module = await import("./promotion/page.tsx");
  await import("./promotion/promotion.css");
  return { default: module.PromotionPage };
});
const HomePage = lazy(async () => {
  const module = await import("./home-page.tsx");
  return { default: module.HomePage };
});
const OpsHomeOverview = lazy(async () => {
  const module = await import("./ops/home-overview.tsx");
  return { default: module.OpsHomeOverview };
});
const ServicesPage = lazy(async () => {
  const module = await import("./ops/services-page.tsx");
  return { default: module.ServicesPage };
});
const ServicePage = lazy(async () => {
  const module = await import("./ops/service-page.tsx");
  return { default: module.ServicePage };
});
const FlowPage = lazy(async () => {
  const module = await import("./ops/section-page.tsx");
  return { default: module.FlowPage };
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
    { path: "promotion", page: PromotionPage },
    { path: "", page: HomePage },
    // Home absorbed the Overview page; its URL still resolves.
    { path: "overview", page: OverviewRedirect },
    { path: "services", page: ServicesPage },
    { path: "services/:id", page: ServicePage },
    { path: "flow", page: FlowPage },
    // Flow lived at /delivery; its URL still resolves.
    { path: "delivery", page: DeliveryRedirect },
    { path: "ai", page: AiPage },
    { path: "maintenance", page: MaintenancePage },
    { path: "review", page: ReviewPage },
    { path: "alerts", page: DashboardPage },
    { path: "alerts/:id", page: AlertDetailPage },
    { path: "history", page: HistoryPage },
    { path: "system", page: SystemPage },
  ],
  // Entries without a `group` sit under the module title, "Ops".
  nav: [
    { label: "Home", icon: HouseIcon, path: "" },
    { label: "Services", icon: BoxesIcon, path: "services" },
    // "Flow", not "Delivery": Delivery is the separate release app.
    { label: "Flow", icon: GitPullRequestIcon, path: "flow" },
    { label: "AI", icon: BotIcon, path: "ai" },
    { label: "Maintenance", icon: WrenchIcon, path: "maintenance" },
    { label: "Review", icon: CalendarRangeIcon, path: "review" },
    {
      label: "Active",
      title: "Active alerts",
      group: "Alerts",
      icon: ActivityIcon,
      path: "alerts",
    },
    { label: "History", group: "Alerts", icon: HistoryIcon, path: "history" },
    { label: "System", group: "Alerts", icon: ServerCogIcon, path: "system" },
    {
      label: "Promotion",
      group: "The Storm",
      icon: MegaphoneIcon,
      path: "promotion",
    },
  ],
  commands: coreCommands,
  search: coreSearch,
  homeCards: [{ id: "overview", card: OpsHomeOverview }],
};
