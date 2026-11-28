/** Read-only sections of an incident's page: facts, signals, links, affected actors, timeline. */
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { IncidentDetail, IncidentSuspect } from "#shared/contract.ts";
import {
  actorLabel,
  EVENT_LABEL,
  eventDetail,
  formatAge,
  formatInstant,
  KIND_LABEL,
} from "#client/format.ts";
import { SeverityBadge, StatusBadge, SystemList } from "#client/ui.tsx";

function Fact({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="inc-fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function suspectParts(suspect: IncidentSuspect): string[] {
  return [
    suspect.prNumber === undefined ? null : `PR #${String(suspect.prNumber)}`,
    suspect.commitSha === undefined ? null : suspect.commitSha.slice(0, 12),
    suspect.branch === undefined ? null : `branch ${suspect.branch}`,
    suspect.sessionId === undefined ? null : `session ${suspect.sessionId}`,
    suspect.author ?? null,
  ].filter((part) => part !== null);
}

export function IncidentFacts({
  incident,
  nowMs,
}: {
  readonly incident: IncidentDetail;
  readonly nowMs: number;
}): React.JSX.Element {
  return (
    <section className="inc-panel inc-facts" aria-labelledby="inc-facts-title">
      <h2 className="ui-section-title inc-panel-title" id="inc-facts-title">
        Summary
      </h2>
      <dl className="inc-fact-grid">
        <Fact term="Severity">
          <SeverityBadge severity={incident.severity} />
        </Fact>
        <Fact term="Status">
          <StatusBadge status={incident.status} />
        </Fact>
        <Fact term="Kind">{KIND_LABEL[incident.kind]}</Fact>
        <Fact term="Systems">
          <SystemList systems={incident.systems} />
        </Fact>
        <Fact term="Components">
          {incident.components.length === 0
            ? "—"
            : incident.components.join(", ")}
        </Fact>
        <Fact term="Declared">
          <time dateTime={incident.declaredAt}>
            {formatInstant(incident.declaredAt, nowMs)}
          </time>{" "}
          ({formatAge(incident.declaredAt, nowMs)} ago, {incident.source})
        </Fact>
        <Fact term="Creator">
          {incident.creator === null ? "—" : actorLabel(incident.creator)}
        </Fact>
        <Fact term="Suspect">
          {incident.suspect === null
            ? "None recorded"
            : suspectParts(incident.suspect).join(" · ")}
        </Fact>
        {incident.scheduledStart === null ? null : (
          <Fact term="Window">
            <time dateTime={incident.scheduledStart}>
              {formatInstant(incident.scheduledStart, nowMs)}
            </time>
            {incident.scheduledEnd === null ? null : (
              <>
                {" – "}
                <time dateTime={incident.scheduledEnd}>
                  {formatInstant(incident.scheduledEnd, nowMs)}
                </time>
              </>
            )}
          </Fact>
        )}
      </dl>
      <div className="inc-prose">
        <h3>Exit condition</h3>
        <p className="inc-exit">{incident.exitCondition}</p>
        {incident.summary === "" ? null : (
          <>
            <h3>What is happening</h3>
            <p>{incident.summary}</p>
          </>
        )}
        {incident.impact === null ? null : (
          <>
            <h3>Impact</h3>
            <p>{incident.impact}</p>
          </>
        )}
        {incident.resolutionNote === null ? null : (
          <>
            <h3>Resolution</h3>
            <p>{incident.resolutionNote}</p>
          </>
        )}
      </div>
    </section>
  );
}

export function SignalsTable({
  incident,
  nowMs,
}: {
  readonly incident: IncidentDetail;
  readonly nowMs: number;
}): React.JSX.Element {
  return (
    <section className="inc-panel">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="inc-signals-title">
          Signals
        </h2>
        <span className="ui-count">{incident.signals.length}</span>
      </div>
      {incident.signals.length === 0 ? (
        <p className="inc-empty">No machine signals are attached.</p>
      ) : (
        <div
          className="inc-table-wrap"
          role="region"
          aria-labelledby="inc-signals-title"
          tabIndex={0}
        >
          <table
            className="ui-table inc-table inc-signal-table"
            aria-labelledby="inc-signals-title"
          >
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">Source</th>
                <th scope="col">State</th>
                <th scope="col">First fired</th>
                <th scope="col">Last change</th>
              </tr>
            </thead>
            <tbody>
              {incident.signals.map((signal) => (
                <tr key={signal.key}>
                  <th scope="row" className="inc-lead">
                    <span className="inc-title">{signal.title}</span>
                    <span className="inc-key ui-mono">{signal.key}</span>
                  </th>
                  <td data-label="Source">{signal.source}</td>
                  <td data-label="State">
                    <span
                      className="inc-sev"
                      data-sev={signal.firing ? "error" : "ok"}
                    >
                      {signal.firing ? "Firing" : "Cleared"}
                    </span>
                  </td>
                  <td data-label="First fired">
                    <time dateTime={signal.firstFiredAt}>
                      {formatInstant(signal.firstFiredAt, nowMs)}
                    </time>
                  </td>
                  <td data-label="Last change">
                    <time dateTime={signal.lastChangedAt}>
                      {formatAge(signal.lastChangedAt, nowMs)} ago
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LinksList({
  incident,
  children,
}: {
  readonly incident: IncidentDetail;
  /** The add-link form. */
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <section className="inc-panel" aria-labelledby="inc-links-title">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="inc-links-title">
          Links
        </h2>
        <span className="ui-count">{incident.links.length}</span>
      </div>
      {incident.links.length === 0 ? (
        <p className="inc-empty">No links yet.</p>
      ) : (
        <ul className="inc-list">
          {incident.links.map((link) => (
            <li key={link.id}>
              <span className="inc-link-kind">{link.kind}</span>
              {link.url === undefined ? (
                <span>{link.title ?? link.ref}</span>
              ) : (
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.title ?? link.ref}
                  <ExternalLinkIcon aria-hidden="true" />
                </a>
              )}
              {link.title === undefined ? null : (
                <span className="ui-muted ui-mono">{link.ref}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}

export function AffectedList({
  incident,
  nowMs,
}: {
  readonly incident: IncidentDetail;
  readonly nowMs: number;
}): React.JSX.Element {
  return (
    <section className="inc-panel" aria-labelledby="inc-affected-title">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="inc-affected-title">
          Affected
        </h2>
        <span className="ui-count">{incident.affected.length}</span>
      </div>
      {incident.affected.length === 0 ? (
        <p className="inc-empty">Nobody has joined as blocked.</p>
      ) : (
        <ul className="inc-list">
          {incident.affected.map(({ actor, joinedAt }) => (
            <li key={actor.id}>
              <span>{actorLabel(actor)}</span>
              <span className="ui-muted">
                joined{" "}
                <time dateTime={joinedAt}>{formatAge(joinedAt, nowMs)}</time>{" "}
                ago
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Timeline({
  incident,
  nowMs,
}: {
  readonly incident: IncidentDetail;
  readonly nowMs: number;
}): React.JSX.Element {
  const events = [...incident.timeline].sort((a, b) => b.seq - a.seq);
  return (
    <section className="inc-panel" aria-labelledby="inc-timeline-title">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="inc-timeline-title">
          Timeline
        </h2>
        <span className="ui-count">{events.length}</span>
      </div>
      <ol className="inc-timeline" aria-label="Timeline, newest first">
        {events.map((event) => {
          const detail = eventDetail(event.type, event.data);
          return (
            <li key={event.id} className="inc-event" data-type={event.type}>
              <div className="inc-event-head">
                <strong>{EVENT_LABEL[event.type]}</strong>
                <span className="ui-muted">
                  {event.actor === null ? "system" : actorLabel(event.actor)}
                </span>
                <time dateTime={event.createdAt} className="ui-muted">
                  {formatInstant(event.createdAt, nowMs)}
                </time>
              </div>
              {detail === null ? null : (
                <p className="inc-event-detail">{detail}</p>
              )}
              {event.body === null ? null : (
                <p className="inc-event-body">{event.body}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
