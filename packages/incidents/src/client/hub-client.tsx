/**
 * `@shepherdjerred/incidents/hub-client`: the Hub client module. The object
 * is structurally a Hub `ClientModule`; Hub's adapter checks it with
 * `satisfies`, so this package never imports alert-dashboard. Pages load
 * lazily, each in its own chunk.
 */
import {
  CalendarClockIcon,
  HistoryIcon,
  PlusIcon,
  SirenIcon,
} from "lucide-react";
import { lazy } from "react";
import {
  INCIDENTS_MODULE_ID,
  incidentIdentifier,
  parseIncidentNumber,
} from "#shared/contract.ts";
import { fetchIncidentsForSearch } from "#client/api.ts";
import { SEVERITY_LABEL, sortIncidents, STATUS_LABEL } from "#client/format.ts";
import { INCIDENTS_BASE_PATH, incidentPath } from "#client/paths.ts";

const OpenIncidentsPage = lazy(async () => {
  const module = await import("#client/list-page.tsx");
  return { default: module.OpenIncidentsPage };
});
const MaintenancePage = lazy(async () => {
  const module = await import("#client/list-page.tsx");
  return { default: module.MaintenancePage };
});
const IncidentHistoryPage = lazy(async () => {
  const module = await import("#client/list-page.tsx");
  return { default: module.IncidentHistoryPage };
});
const IncidentDetailPage = lazy(async () => {
  const module = await import("#client/detail-page.tsx");
  return { default: module.IncidentDetailPage };
});
const DeclareIncidentPage = lazy(async () => {
  const module = await import("#client/declare-page.tsx");
  return { default: module.DeclareIncidentPage };
});
const IncidentsHomeCard = lazy(async () => {
  const module = await import("#client/home-card.tsx");
  return { default: module.IncidentsHomeCard };
});

const GROUP = "Incidents";

const MAX_RESULTS = 8;

type SearchResult = {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly detail?: string;
  readonly to: string;
};

/** Palette search: `INC-N` jumps straight to the record; other text matches titles. */
export async function incidentsPaletteSearch(
  query: string,
  signal: AbortSignal,
): Promise<readonly SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const number = parseIncidentNumber(trimmed);
  const needle = trimmed.toLowerCase();
  const incidents = sortIncidents(await fetchIncidentsForSearch(signal));
  const matches = incidents
    .filter(
      (incident) =>
        incident.number === number ||
        incident.title.toLowerCase().includes(needle) ||
        incident.identifier.toLowerCase() === needle,
    )
    .slice(0, MAX_RESULTS)
    .map((incident) => ({
      id: `incident-${incident.id}`,
      group: GROUP,
      label: `${incident.identifier} · ${incident.title}`,
      detail: `${SEVERITY_LABEL[incident.severity]} · ${STATUS_LABEL[incident.status]}`,
      to: incidentPath(incident.number),
    }));
  if (
    number === null ||
    matches.some((match) => match.to === incidentPath(number))
  )
    return matches;
  return [
    {
      id: `jump-${String(number)}`,
      group: GROUP,
      label: `Open ${incidentIdentifier(number)}`,
      detail: "Direct incident lookup",
      to: incidentPath(number),
    },
    ...matches,
  ];
}

export const incidentsHubClient = {
  id: INCIDENTS_MODULE_ID,
  title: "Incidents",
  icon: SirenIcon,
  basePath: INCIDENTS_BASE_PATH,
  routes: [
    { path: "", page: OpenIncidentsPage },
    { path: "maintenance", page: MaintenancePage },
    { path: "history", page: IncidentHistoryPage },
    { path: "new", page: DeclareIncidentPage },
    { path: ":ref", page: IncidentDetailPage },
  ],
  // One sidebar row: Hub keeps every sidebar link on screen at 1280x720,
  // and core already owns "Maintenance" and "History". The list pages link
  // their three views, and the palette has a command for each.
  nav: [
    {
      label: "Incidents",
      title: "Open incidents",
      group: "Alerts",
      icon: SirenIcon,
      path: "",
      keywords: [
        "incidents",
        "outage",
        "broken",
        "commander",
        "red main",
        "delivery",
      ],
    },
  ],
  commands: [
    {
      id: "maintenance",
      label: "Maintenance windows",
      icon: CalendarClockIcon,
      keywords: ["incidents", "planned", "window", "upgrade"],
      run: ({ navigate }: { readonly navigate: (to: string) => void }) => {
        navigate(`${INCIDENTS_BASE_PATH}/maintenance`);
      },
    },
    {
      id: "history",
      label: "Incident history",
      icon: HistoryIcon,
      keywords: ["resolved incidents", "postmortem", "past incidents"],
      run: ({ navigate }: { readonly navigate: (to: string) => void }) => {
        navigate(`${INCIDENTS_BASE_PATH}/history`);
      },
    },
    {
      id: "declare",
      label: "Declare incident",
      icon: PlusIcon,
      keywords: ["new incident", "open incident", "maintenance", "outage"],
      run: ({ navigate }: { readonly navigate: (to: string) => void }) => {
        navigate(`${INCIDENTS_BASE_PATH}/new`);
      },
    },
  ],
  search: incidentsPaletteSearch,
  homeCards: [{ id: "open", card: IncidentsHomeCard }],
};
