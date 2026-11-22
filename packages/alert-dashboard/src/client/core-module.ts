import {
  ActivityIcon,
  BotIcon,
  BoxesIcon,
  CalendarRangeIcon,
  CpuIcon,
  FolderGit2Icon,
  Gamepad2Icon,
  GaugeIcon,
  GitPullRequestIcon,
  HistoryIcon,
  HouseIcon,
  MailIcon,
  MegaphoneIcon,
  RefreshCwIcon,
  ServerCogIcon,
  TrendingUpIcon,
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
const ClusterPage = lazy(async () => {
  const module = await import("./ops/pages/cluster-page.tsx");
  return { default: module.ClusterPage };
});
const ServicesPage = lazy(async () => {
  const module = await import("./ops/services-page.tsx");
  return { default: module.ServicesPage };
});
const ServicePage = lazy(async () => {
  const module = await import("./ops/service-page.tsx");
  return { default: module.ServicePage };
});
const MonorepoPage = lazy(async () => {
  const module = await import("./ops/pages/monorepo-page.tsx");
  return { default: module.MonorepoPage };
});
const FlowPage = lazy(async () => {
  const module = await import("./ops/section-page.tsx");
  return { default: module.FlowPage };
});
const RenovatePage = lazy(async () => {
  const module = await import("./ops/pages/renovate-page.tsx");
  return { default: module.RenovatePage };
});
const ProductPage = lazy(async () => {
  const module = await import("./ops/pages/product-page.tsx");
  return { default: module.ProductPage };
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
const ReportsPage = lazy(async () => {
  const module = await import("./reports/reports-page.tsx");
  return { default: module.ReportsPage };
});
const ReportRunPage = lazy(async () => {
  const module = await import("./reports/report-run-page.tsx");
  return { default: module.ReportRunPage };
});
const DigestRunPage = lazy(async () => {
  const module = await import("./reports/digest-run-page.tsx");
  return { default: module.DigestRunPage };
});
const IncidentMailPage = lazy(async () => {
  const module = await import("./reports/incident-mail-page.tsx");
  return { default: module.IncidentMailPage };
});
const TheStormPage = lazy(async () => {
  const module = await import("./ops/pages/the-storm-page.tsx");
  return { default: module.TheStormPage };
});
const DashboardPage = lazy(async () => {
  const module = await import("./dashboard-page.tsx");
  return { default: module.DashboardPage };
});
const HousePage = lazy(async () => {
  const module = await import("./house-page.tsx");
  return { default: module.HousePage };
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
    { path: "the-storm", page: TheStormPage },
    { path: "promotion", page: PromotionPage },
    { path: "", page: HomePage },
    // Home absorbed the Overview page; its URL still resolves.
    { path: "overview", page: OverviewRedirect },
    { path: "cluster", page: ClusterPage },
    { path: "services", page: ServicesPage },
    { path: "services/:id", page: ServicePage },
    { path: "monorepo", page: MonorepoPage },
    { path: "flow", page: FlowPage },
    // Flow lived at /delivery; its URL still resolves.
    { path: "delivery", page: DeliveryRedirect },
    { path: "renovate", page: RenovatePage },
    { path: "product", page: ProductPage },
    { path: "ai", page: AiPage },
    { path: "maintenance", page: MaintenancePage },
    { path: "review", page: ReviewPage },
    { path: "reports", page: ReportsPage },
    { path: "reports/runs/:id", page: ReportRunPage },
    { path: "reports/digests/:kind/:periodKey", page: DigestRunPage },
    { path: "reports/mail/:id", page: IncidentMailPage },
    { path: "alerts", page: DashboardPage },
    { path: "alerts/:id", page: AlertDetailPage },
    { path: "house", page: HousePage },
    { path: "history", page: HistoryPage },
    { path: "system", page: SystemPage },
  ],
  // Entries without a `group` sit under the module title, "Ops".
  nav: [
    { label: "Home", icon: HouseIcon, path: "" },
    { label: "Cluster", icon: CpuIcon, path: "cluster" },
    { label: "Services", icon: BoxesIcon, path: "services" },
    { label: "Monorepo", icon: FolderGit2Icon, path: "monorepo" },
    // "Flow", not "Delivery": Delivery is the separate release app.
    { label: "Flow", icon: GitPullRequestIcon, path: "flow" },
    { label: "Renovate", icon: RefreshCwIcon, path: "renovate" },
    { label: "Product", icon: TrendingUpIcon, path: "product" },
    { label: "AI", icon: BotIcon, path: "ai" },
    { label: "Maintenance", icon: WrenchIcon, path: "maintenance" },
    { label: "Review", icon: CalendarRangeIcon, path: "review" },
    {
      label: "Reports",
      icon: MailIcon,
      path: "reports",
      keywords: [
        "reports",
        "emails",
        "mail",
        "digests",
        "deadlinks",
        "vulnerabilities",
        "lychee",
        "trivy",
      ],
    },
    {
      label: "Active",
      title: "Active alerts",
      group: "Alerts",
      icon: ActivityIcon,
      path: "alerts",
    },
    {
      label: "House",
      group: "Alerts",
      icon: HouseIcon,
      path: "house",
      keywords: ["house", "chores", "home", "pets", "vacuum", "litter"],
    },
    { label: "History", group: "Alerts", icon: HistoryIcon, path: "history" },
    { label: "System", group: "Alerts", icon: ServerCogIcon, path: "system" },
    {
      label: "Overview",
      title: "The Storm overview",
      group: "The Storm",
      icon: Gamepad2Icon,
      path: "the-storm",
    },
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
