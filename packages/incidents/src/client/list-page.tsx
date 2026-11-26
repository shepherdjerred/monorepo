import { FigureStrip, type Figure } from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import {
  INCIDENT_SYSTEMS,
  IncidentKindSchema,
  IncidentSystemSchema,
  isOpenStatus,
  ListIncidentsInputSchema,
  type IncidentSummary,
  type ListIncidentsInput,
} from "#shared/contract.ts";
import { actingActor, incidentListQuery, viewerQuery } from "#client/api.ts";
import {
  formatAge,
  KIND_LABEL,
  sortIncidents,
  systemLabel,
} from "#client/format.ts";
import { useIncidentStream, useNow } from "#client/live.ts";
import { INCIDENTS_BASE_PATH, incidentPath } from "#client/paths.ts";
import {
  ActingAs,
  CommandState,
  IncidentsHeading,
  LiveStatus,
  SeverityBadge,
  StatusBadge,
  SystemList,
} from "#client/ui.tsx";
import "./incidents.css";

export type ListPreset = "open" | "maintenance" | "history";

const PRESETS: Readonly<
  Record<
    ListPreset,
    {
      readonly title: string;
      readonly eyebrow: string;
      readonly filter: ListIncidentsInput;
    }
  >
> = {
  open: {
    title: "Open incidents",
    eyebrow: "Incidents · shared-system breakage",
    filter: { state: "open" },
  },
  maintenance: {
    title: "Maintenance",
    eyebrow: "Incidents · planned windows",
    filter: { state: "open", kind: "maintenance" },
  },
  history: {
    title: "Incident history",
    eyebrow: "Incidents · resolved and completed",
    filter: { state: "resolved" },
  },
};

const StateParamSchema = ListIncidentsInputSchema.shape.state.unwrap();

/** The preset's filter with any valid `kind`, `state`, `system` search params on top. */
export function listFilter(
  preset: ListPreset,
  params: URLSearchParams,
): ListIncidentsInput {
  const base = PRESETS[preset].filter;
  const kind = IncidentKindSchema.safeParse(params.get("kind"));
  const state = StateParamSchema.safeParse(params.get("state"));
  const system = IncidentSystemSchema.safeParse(params.get("system"));
  return {
    ...base,
    limit: 200,
    ...(kind.success ? { kind: kind.data } : {}),
    ...(state.success ? { state: state.data } : {}),
    ...(system.success ? { system: system.data } : {}),
  };
}

function figures(incidents: readonly IncidentSummary[]): Figure[] {
  const open = incidents.filter((incident) => isOpenStatus(incident.status));
  const sev1 = open.filter((incident) => incident.severity === "sev1").length;
  // Takeover is for broken shared systems: unowned maintenance is not news.
  const unowned = open.filter(
    (incident) =>
      incident.kind === "incident" && incident.command.state === "none",
  ).length;
  const firing = open.reduce(
    (sum, incident) => sum + incident.firingSignals,
    0,
  );
  return [
    {
      label: "Open",
      value: open.length,
      ...(open.length > 0 ? { severity: "warning" as const } : {}),
    },
    {
      label: "SEV1 open",
      value: sev1,
      ...(sev1 > 0 ? { severity: "error" as const } : {}),
    },
    {
      label: "Unowned",
      value: unowned,
      hint: "Incidents with no commander or dispatch lease",
      ...(unowned > 0 ? { severity: "warning" as const } : {}),
    },
    { label: "Firing signals", value: firing },
  ];
}

const VIEW_LINKS: readonly {
  readonly preset: ListPreset;
  readonly label: string;
  readonly to: string;
}[] = [
  { preset: "open", label: "Open", to: INCIDENTS_BASE_PATH },
  {
    preset: "maintenance",
    label: "Maintenance",
    to: `${INCIDENTS_BASE_PATH}/maintenance`,
  },
  { preset: "history", label: "History", to: `${INCIDENTS_BASE_PATH}/history` },
];

/** The three list views, as links: each is its own URL and history entry. */
export function ViewLinks({
  current,
}: {
  readonly current: ListPreset;
}): React.JSX.Element {
  return (
    <nav className="inc-views" aria-label="Incident views">
      {VIEW_LINKS.map((view) => (
        <Link
          key={view.preset}
          className="inc-view"
          to={view.to}
          aria-current={view.preset === current ? "page" : undefined}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}

export function IncidentTable({
  incidents,
  nowMs,
  captionId,
}: {
  readonly incidents: readonly IncidentSummary[];
  readonly nowMs: number;
  readonly captionId: string;
}): React.JSX.Element {
  if (incidents.length === 0)
    return <p className="empty-state">No incidents match these filters.</p>;
  return (
    <div
      className="inc-table-wrap"
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
    >
      <table className="ui-table inc-table" aria-labelledby={captionId}>
        <thead>
          <tr>
            <th scope="col">Incident</th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
            <th scope="col">Systems</th>
            <th scope="col">Command</th>
            <th scope="col" className="ui-num">
              Firing
            </th>
            <th scope="col" className="ui-num">
              Affected
            </th>
            <th scope="col" className="ui-num">
              Age
            </th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id} data-open={isOpenStatus(incident.status)}>
              <th scope="row" className="inc-lead">
                <Link
                  className="inc-row-link"
                  to={incidentPath(incident.number)}
                >
                  <span className="inc-id">{incident.identifier}</span>
                  <span className="inc-title">{incident.title}</span>
                </Link>
                {incident.kind === "maintenance" ? (
                  <span className="inc-kind">{KIND_LABEL.maintenance}</span>
                ) : null}
              </th>
              <td data-label="Severity">
                <SeverityBadge severity={incident.severity} />
              </td>
              <td data-label="Status">
                <StatusBadge status={incident.status} />
              </td>
              <td data-label="Systems">
                <SystemList systems={incident.systems} />
              </td>
              <td data-label="Command">
                <CommandState
                  command={incident.command}
                  kind={incident.kind}
                  nowMs={nowMs}
                />
              </td>
              <td data-label="Firing signals" className="ui-num">
                {incident.firingSignals}
              </td>
              <td data-label="Affected" className="ui-num">
                {incident.affectedCount}
              </td>
              <td data-label="Age" className="ui-num">
                <time dateTime={incident.declaredAt}>
                  {formatAge(incident.declaredAt, nowMs)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilterBar({
  filter,
  onChange,
  onReset,
  baseId,
}: {
  readonly filter: ListIncidentsInput;
  readonly onChange: (key: "kind" | "state" | "system", value: string) => void;
  readonly onReset: (() => void) | null;
  readonly baseId: string;
}): React.JSX.Element {
  return (
    <search className="ui-toolbar inc-filters">
      <div className="inc-filter">
        <label htmlFor={`${baseId}-state`}>State</label>
        <select
          id={`${baseId}-state`}
          value={filter.state ?? "open"}
          onChange={(event) => {
            onChange("state", event.target.value);
          }}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
      </div>
      <div className="inc-filter">
        <label htmlFor={`${baseId}-kind`}>Kind</label>
        <select
          id={`${baseId}-kind`}
          value={filter.kind ?? ""}
          onChange={(event) => {
            onChange("kind", event.target.value);
          }}
        >
          <option value="">All kinds</option>
          <option value="incident">Incidents</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </div>
      <div className="inc-filter">
        <label htmlFor={`${baseId}-system`}>System</label>
        <select
          id={`${baseId}-system`}
          value={filter.system ?? ""}
          onChange={(event) => {
            onChange("system", event.target.value);
          }}
        >
          <option value="">All systems</option>
          {INCIDENT_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {systemLabel(system)}
            </option>
          ))}
        </select>
      </div>
      {onReset === null ? null : (
        <button type="button" className="ui-btn" onClick={onReset}>
          <XIcon aria-hidden="true" />
          Reset
        </button>
      )}
    </search>
  );
}

function ListPage({ preset }: { readonly preset: ListPreset }) {
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => listFilter(preset, params), [preset, params]);
  const list = useQuery(incidentListQuery(filter));
  const viewer = useQuery(viewerQuery());
  const stream = useIncidentStream(null);
  const nowMs = useNow();
  const baseId = useId();
  const captionId = `${baseId}-caption`;
  const { title, eyebrow } = PRESETS[preset];
  const hasOverrides = ["kind", "state", "system"].some((key) =>
    params.has(key),
  );

  const change = (key: "kind" | "state" | "system", value: string) => {
    const next = new URLSearchParams(params);
    if (value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const incidents = list.data === undefined ? [] : sortIncidents(list.data);
  const viewerValue = viewer.data ?? null;

  return (
    <main className="inc-page">
      <title>{`${title} · Hub`}</title>
      <IncidentsHeading eyebrow={eyebrow} title={title}>
        <LiveStatus snapshot={stream} />
        <Link
          className="ui-btn"
          data-variant="primary"
          to={`${INCIDENTS_BASE_PATH}/new`}
        >
          <PlusIcon aria-hidden="true" />
          Declare incident
        </Link>
      </IncidentsHeading>
      <ActingAs viewer={viewerValue} actor={actingActor(viewerValue)} />
      <ViewLinks current={preset} />
      {list.data === undefined ? null : (
        <FigureStrip figures={figures(incidents)} />
      )}
      <section className="inc-panel">
        <div className="ui-section-head">
          <h2 className="ui-section-title" id={captionId}>
            {title}
          </h2>
          {list.data === undefined ? null : (
            <span className="ui-count">{incidents.length}</span>
          )}
        </div>
        <FilterBar
          filter={filter}
          onChange={change}
          onReset={
            hasOverrides
              ? () => {
                  setParams(new URLSearchParams(), { replace: true });
                }
              : null
          }
          baseId={baseId}
        />
        {list.isPending ? (
          <p className="loading-state">Loading incidents…</p>
        ) : list.isError ? (
          <p className="error-state">
            Incidents are unavailable: {list.error.message}
          </p>
        ) : (
          <IncidentTable
            incidents={incidents}
            nowMs={nowMs}
            captionId={captionId}
          />
        )}
      </section>
    </main>
  );
}

export function OpenIncidentsPage(): React.JSX.Element {
  return <ListPage preset="open" />;
}

export function MaintenancePage(): React.JSX.Element {
  return <ListPage preset="maintenance" />;
}

export function IncidentHistoryPage(): React.JSX.Element {
  return <ListPage preset="history" />;
}
