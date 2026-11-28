import { useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, SirenIcon } from "lucide-react";
import { Link } from "react-router";
import type { IncidentSummary } from "#shared/contract.ts";
import { incidentListQuery } from "#client/api.ts";
import { formatAge, formatInstant, sortIncidents } from "#client/format.ts";
import { useIncidentStream, useNow } from "#client/live.ts";
import { INCIDENTS_BASE_PATH, incidentPath } from "#client/paths.ts";
import {
  CommandState,
  SeverityBadge,
  StatusBadge,
  SystemList,
} from "#client/ui.tsx";
import "./incidents.css";

function HomeRow({
  incident,
  nowMs,
}: {
  readonly incident: IncidentSummary;
  readonly nowMs: number;
}): React.JSX.Element {
  return (
    <li className="inc-home-row">
      <Link className="inc-row-link" to={incidentPath(incident.number)}>
        <span className="inc-id">{incident.identifier}</span>
        <span className="inc-title">{incident.title}</span>
      </Link>
      <div className="inc-home-meta">
        <SeverityBadge severity={incident.severity} />
        <StatusBadge status={incident.status} />
        <SystemList systems={incident.systems} />
        {incident.kind === "maintenance" && incident.scheduledStart !== null ? (
          <span className="ui-muted">
            Starts{" "}
            <time dateTime={incident.scheduledStart}>
              {formatInstant(incident.scheduledStart, nowMs)}
            </time>
          </span>
        ) : (
          <span className="ui-muted">
            Open{" "}
            <time dateTime={incident.declaredAt}>
              {formatAge(incident.declaredAt, nowMs)}
            </time>
          </span>
        )}
      </div>
      <CommandState
        command={incident.command}
        kind={incident.kind}
        nowMs={nowMs}
      />
    </li>
  );
}

export function HomeCardView({
  incidents,
  nowMs,
}: {
  readonly incidents: readonly IncidentSummary[];
  readonly nowMs: number;
}): React.JSX.Element {
  const sorted = sortIncidents(incidents);
  const open = sorted.filter((incident) => incident.kind === "incident");
  const windows = sorted.filter((incident) => incident.kind === "maintenance");
  return (
    <div className="inc-home-grid">
      <div className="inc-panel inc-home-panel">
        <h3 className="inc-home-title">
          <SirenIcon aria-hidden="true" />
          Open incidents
        </h3>
        {open.length === 0 ? (
          <p className="inc-empty inc-calm">No open incidents.</p>
        ) : (
          <ul className="inc-home-list">
            {open.map((incident) => (
              <HomeRow key={incident.id} incident={incident} nowMs={nowMs} />
            ))}
          </ul>
        )}
      </div>
      <div className="inc-panel inc-home-panel">
        <h3 className="inc-home-title">
          <CalendarClockIcon aria-hidden="true" />
          Maintenance windows
        </h3>
        {windows.length === 0 ? (
          <p className="inc-empty">No maintenance scheduled or underway.</p>
        ) : (
          <ul className="inc-home-list">
            {windows.map((incident) => (
              <HomeRow key={incident.id} incident={incident} nowMs={nowMs} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Home's incidents block: every open record, most severe first, live. */
export function IncidentsHomeCard(): React.JSX.Element {
  const list = useQuery(incidentListQuery({ state: "open", limit: 200 }));
  useIncidentStream(null);
  const nowMs = useNow();
  return (
    <section className="inc-home" aria-labelledby="inc-home-heading">
      <h2 className="block-heading" id="inc-home-heading">
        <Link to={INCIDENTS_BASE_PATH}>Incidents</Link>
      </h2>
      {list.isPending ? (
        <p className="loading-state">Loading incidents…</p>
      ) : list.isError ? (
        <p className="error-state">Incidents are unavailable.</p>
      ) : (
        <HomeCardView incidents={list.data} nowMs={nowMs} />
      )}
    </section>
  );
}
