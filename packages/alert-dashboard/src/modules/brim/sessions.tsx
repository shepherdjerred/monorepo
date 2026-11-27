import { useQuery } from "@tanstack/react-query";
import { useId, useState, type SubmitEvent } from "react";
import { Link, useParams } from "react-router";

import { providerLabel } from "#client/ops/ai-labels.ts";

import { brimQuery } from "./api.ts";
import {
  BrimPage,
  BrimPager,
  BrimQueryState,
  BrimSection,
  BrimTable,
  dateLabel,
  quantity,
} from "./presentation.tsx";
import {
  BrimOverviewSchema,
  HistoryCapturesSchema,
  HistoryFacetsSchema,
  HistorySessionDetailSchema,
  HistorySessionsSchema,
  type HistorySession,
} from "./schema.ts";

const sessionPageSize = 40;
const messagesPageSize = 40;
const capturesPageSize = 30;

function sourceName(source: string): string {
  return providerLabel(source.replace(/-mirror$/u, ""));
}

function sessionLabel(session: HistorySession): string {
  return session.title.trim() === "" ? "Untitled session" : session.title;
}

function formString(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function BrimSessionsPage() {
  const filterId = useId();
  const [filters, setFilters] = useState({
    q: "",
    machine: "",
    source: "",
    workspace: "",
  });
  const [offset, setOffset] = useState(0);
  const facets = useQuery(
    brimQuery("history/facets", HistoryFacetsSchema, 60_000),
  );
  const overview = useQuery(
    brimQuery("overview?includeQuotaHistory=false", BrimOverviewSchema),
  );
  const machines = new Map(
    overview.data?.archive.devices.map((device) => [
      device.machineId,
      device.displayName,
    ]),
  );
  const endpoint = filters.q === "" ? "sessions" : "search";
  const params = new URLSearchParams({
    limit: String(sessionPageSize),
    offset: String(offset),
  });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "") params.set(key, value);
  }
  const sessions = useQuery(
    brimQuery(
      `history/${endpoint}?${params.toString()}`,
      HistorySessionsSchema,
    ),
  );

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setOffset(0);
    setFilters({
      q: formString(data, "q"),
      machine: formString(data, "machine"),
      source: formString(data, "source"),
      workspace: formString(data, "workspace"),
    });
  }

  const latest = sessions.data;
  return (
    <BrimPage title="Brim sessions">
      <BrimSection title="Search archived sessions">
        <search>
          <form
            className="brim-search"
            action="/brim/sessions"
            method="get"
            onSubmit={submit}
          >
            <label htmlFor={`${filterId}-query`}>
              Transcript text
              <input
                id={`${filterId}-query`}
                name="q"
                type="search"
                maxLength={512}
              />
            </label>
            <label htmlFor={`${filterId}-machine`}>
              Device
              <select id={`${filterId}-machine`} name="machine">
                <option value="">All devices</option>
                {facets.data?.machines.flatMap(({ key }) =>
                  key === null
                    ? []
                    : [
                        <option key={key} value={key}>
                          {machines.get(key) ?? key}
                        </option>,
                      ],
                )}
              </select>
            </label>
            <label htmlFor={`${filterId}-source`}>
              Source
              <select id={`${filterId}-source`} name="source">
                <option value="">All sources</option>
                {facets.data?.sources.flatMap(({ key }) =>
                  key === null
                    ? []
                    : [
                        <option key={key} value={key}>
                          {sourceName(key)}
                        </option>,
                      ],
                )}
              </select>
            </label>
            <label htmlFor={`${filterId}-workspace`}>
              Workspace
              <select id={`${filterId}-workspace`} name="workspace">
                <option value="">All workspaces</option>
                {facets.data?.workspaces.flatMap(({ key }) =>
                  key === null
                    ? []
                    : [
                        <option key={key} value={key}>
                          {key}
                        </option>,
                      ],
                )}
              </select>
            </label>
            <button className="ui-btn" type="submit">
              Search
            </button>
          </form>
        </search>
        {facets.error === null ? null : (
          <BrimQueryState error={facets.error} label="search filters" />
        )}
        {latest === undefined ? (
          <BrimQueryState label="sessions" error={sessions.error} />
        ) : (
          <>
            <p className="brim-message" role="status">
              {latest.sessions.length === 0
                ? "No matching sessions."
                : `Showing ${quantity(offset + 1)}–${quantity(offset + latest.sessions.length)}`}
            </p>
            {latest.sessions.length === 0 ? null : (
              <BrimTable
                label="Sessions"
                columns={["Session", "Device", "Source", "Updated", "Messages"]}
              >
                {latest.sessions.map((session) => (
                  <tr key={session.id}>
                    <th scope="row">
                      <Link to={`/brim/sessions/${String(session.id)}`}>
                        {sessionLabel(session)}
                      </Link>
                      {session.workspace === null ? null : (
                        <small>{session.workspace}</small>
                      )}
                    </th>
                    <td>
                      {session.machine === null
                        ? "Local"
                        : (machines.get(session.machine) ?? session.machine)}
                    </td>
                    <td>{sourceName(session.source)}</td>
                    <td>{dateLabel(session.updatedAt)}</td>
                    <td className="ui-num">{quantity(session.messageCount)}</td>
                  </tr>
                ))}
              </BrimTable>
            )}
            <BrimPager
              offset={offset}
              step={sessionPageSize}
              hasMore={latest.hasMore}
              onPage={setOffset}
            />
          </>
        )}
      </BrimSection>
    </BrimPage>
  );
}

function SessionRequests({ sessionId }: { readonly sessionId: string }) {
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({
    session: sessionId,
    offset: String(offset),
    limit: String(capturesPageSize),
  });
  const query = useQuery(
    brimQuery(`history/captures?${params.toString()}`, HistoryCapturesSchema),
  );
  const data = query.data;
  return (
    <BrimSection title="Captured requests">
      {data === undefined ? (
        <BrimQueryState label="captured requests" error={query.error} />
      ) : (
        <>
          {data.captures.length === 0 ? (
            <p className="brim-message">
              No captured requests for this session.
            </p>
          ) : (
            <BrimTable
              label="Captured requests"
              columns={["Request", "Status", "Context blocks", "New blocks"]}
            >
              {data.captures.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link
                      to={`/brim/sessions/${sessionId}/requests/${String(row.id)}`}
                    >
                      {dateLabel(row.startedAt)}
                    </Link>
                    <small>{row.model ?? row.cli}</small>
                  </th>
                  <td>{row.warmup ? "Warm-up" : row.status}</td>
                  <td className="ui-num">{quantity(row.blockCount)}</td>
                  <td className="ui-num">{quantity(row.newBlockCount)}</td>
                </tr>
              ))}
            </BrimTable>
          )}
          <BrimPager
            offset={offset}
            step={capturesPageSize}
            hasMore={data.hasMore}
            onPage={setOffset}
          />
        </>
      )}
    </BrimSection>
  );
}

function SessionView({ sessionId }: { readonly sessionId: string }) {
  const [offset, setOffset] = useState(0);
  const search = new URLSearchParams({
    offset: String(offset),
    limit: String(messagesPageSize),
  });
  const query = useQuery(
    brimQuery(
      `history/sessions/${sessionId}?${search.toString()}`,
      HistorySessionDetailSchema,
    ),
  );
  const data = query.data;
  return (
    <BrimPage
      title={data === undefined ? "Brim session" : sessionLabel(data.session)}
    >
      <div className="brim-back">
        <Link to="/brim/sessions">All sessions</Link>
      </div>
      {data === undefined ? (
        <BrimQueryState label="session" error={query.error} />
      ) : (
        <>
          <div className="brim-source">
            <span>{sourceName(data.session.source)}</span>
            <span>{data.session.machine ?? "Local"}</span>
            {data.session.primaryModel === null ? null : (
              <span>{data.session.primaryModel}</span>
            )}
            {data.session.gitBranch === null ? null : (
              <span>{data.session.gitBranch}</span>
            )}
            <span>Started {dateLabel(data.session.createdAt)}</span>
          </div>
          <BrimSection
            title="Transcript"
            aside={
              <span className="brim-muted">
                {quantity(data.totalMessages)} messages
              </span>
            }
          >
            {data.messages.length === 0 ? (
              <p className="brim-message">
                No transcript messages are available.
              </p>
            ) : (
              <ol className="brim-messages" start={offset + 1}>
                {data.messages.map((message, position) => (
                  <li key={offset + position}>
                    <div className="brim-message-meta">
                      <strong>
                        {providerLabel(message.role)}
                        {message.toolName === null
                          ? ""
                          : ` · ${message.toolName}`}
                      </strong>
                      <span>{dateLabel(message.createdAt)}</span>
                    </div>
                    <pre>{message.text}</pre>
                  </li>
                ))}
              </ol>
            )}
            <BrimPager
              offset={offset}
              step={messagesPageSize}
              hasMore={offset + data.messages.length < data.totalMessages}
              onPage={setOffset}
            />
          </BrimSection>
          <SessionRequests sessionId={sessionId} />
        </>
      )}
    </BrimPage>
  );
}

export function BrimSessionPage() {
  const { sessionId } = useParams();
  if (sessionId === undefined || !/^[1-9]\d*$/u.test(sessionId)) {
    return (
      <BrimPage title="Brim session">
        <p className="brim-message">Invalid session identifier.</p>
      </BrimPage>
    );
  }
  return <SessionView key={sessionId} sessionId={sessionId} />;
}
