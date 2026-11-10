import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { APPS, TOOLS } from "./external-links.ts";
import type {
  ModuleCommand,
  ModuleSearch,
  ModuleSearchResult,
} from "./platform/module.ts";
import type { ThemePreference } from "./theme.ts";
import { trpcClient } from "./trpc.ts";

/**
 * The theme store reads `matchMedia` when it loads, so it is imported on use:
 * the module definitions stay importable without a DOM.
 */
async function applyTheme(preference: ThemePreference): Promise<void> {
  const theme = await import("./theme.ts");
  theme.setThemePreference(preference);
}

const SERVICE_LIMIT = 6;
const ALERT_LIMIT = 6;

/** The core module's palette commands: the apps and tools, and the theme. */
export const coreCommands: readonly ModuleCommand[] = [
  ...[...APPS, ...TOOLS].map((entry) => ({
    id: `open:${entry.label}`,
    label: `Open ${entry.label}`,
    icon: entry.icon,
    keywords: ["launch", "external"],
    run: () => {
      globalThis.open(entry.url, "_blank", "noopener,noreferrer");
    },
  })),
  {
    id: "theme:light",
    label: "Use light theme",
    icon: SunIcon,
    keywords: ["appearance", "mode"],
    run: () => applyTheme("light"),
  },
  {
    id: "theme:dark",
    label: "Use dark theme",
    icon: MoonIcon,
    keywords: ["appearance", "mode"],
    run: () => applyTheme("dark"),
  },
  {
    id: "theme:system",
    label: "Use system theme",
    icon: MonitorIcon,
    keywords: ["appearance", "mode", "auto"],
    run: () => applyTheme("system"),
  },
];

async function searchServices(query: string): Promise<ModuleSearchResult[]> {
  // The catalog is a large static document, so it loads with the first search
  // rather than with the app shell.
  const { ServiceIndex } = await import("@shepherdjerred/ops-model/catalog.ts");
  const needle = query.toLowerCase();
  return new ServiceIndex().services
    .filter(
      (service) =>
        service.id.toLowerCase().includes(needle) ||
        service.title.toLowerCase().includes(needle),
    )
    .slice(0, SERVICE_LIMIT)
    .map((service) => ({
      id: `service:${service.id}`,
      group: "Services",
      label: service.title,
      detail: service.id,
      to: `/services/${service.id}`,
    }));
}

/** The ledger lists newest openings first, so a match is a recent alert. */
async function searchAlerts(
  query: string,
  signal: AbortSignal,
): Promise<ModuleSearchResult[]> {
  const { items } = await trpcClient.alerts.list.query(
    { search: query, limit: ALERT_LIMIT },
    { signal },
  );
  return items.map((alert) => ({
    id: `alert:${alert.id}`,
    group: "Alerts",
    label: alert.summary,
    detail: `${alert.alertname} · ${alert.lifecycleState}`,
    to: `/alerts/${alert.id}`,
  }));
}

/** Catalog services and recent alerts. */
export const coreSearch: ModuleSearch = async (query, signal) => {
  const [services, alerts] = await Promise.all([
    searchServices(query),
    searchAlerts(query, signal),
  ]);
  return [...services, ...alerts];
};
