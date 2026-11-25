import type {
  TraceListItem,
  TraceRange,
  TracesFacetsResponse,
  TracesSearchQuery,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import { SearchIcon } from "lucide-react";
import { Link, useLocation } from "react-router";

import { ServiceLink, services, SeverityBadge } from "#client/ops/ops-ui.tsx";
import { formatValue } from "#shared/ops-format";

import {
  ageFromEpochMs,
  epochMsToIso,
  formatShortTimestamp,
  formatTokenInt,
} from "./traces-format.ts";

function ServiceCell({
  serviceName,
  environment,
}: {
  readonly serviceName: string;
  readonly environment: string | null;
}): React.JSX.Element {
  const catalogMatch =
    services.byId(serviceName) ??
    services.byArgoApp(serviceName) ??
    services.byChart(serviceName) ??
    services.byNamespace(serviceName);

  return (
    <div className="traces-pill-wrap">
      {catalogMatch === undefined ? (
        <span className="mono">{serviceName}</span>
      ) : (
        <ServiceLink id={catalogMatch.id} />
      )}
      {environment === null ? null : (
        <span className="visual-pill visual-pill-neutral">{environment}</span>
      )}
    </div>
  );
}

function TraceRow({
  item,
  fromSearch,
}: {
  readonly item: TraceListItem;
  readonly fromSearch: string;
}): React.JSX.Element {
  const primaryLabel =
    item.workloads[0] ?? item.rootSpanName ?? item.traceId.slice(0, 12);
  const startedIso = epochMsToIso(item.startedAtMs);

  return (
    <tr>
      <td data-label="Trace">
        <div className="traces-cell-stack">
          <Link
            className="traces-row-link"
            to={`/traces/${item.traceId}`}
            state={
              fromSearch === "" ? undefined : { fromTracesSearch: fromSearch }
            }
          >
            {primaryLabel}
          </Link>
          <div className="traces-pill-wrap">
            <code className="mono traces-short-id">
              {item.traceId.slice(0, 12)}
            </code>
            {item.hasToolIo ? (
              <span className="visual-pill visual-pill-info">Tool I/O</span>
            ) : null}
          </div>
        </div>
      </td>
      <td data-label="Service">
        <ServiceCell
          serviceName={item.service}
          environment={item.environment}
        />
      </td>
      <td data-label="Model">
        <div className="traces-pill-wrap">
          {item.models.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            item.models.slice(0, 2).map((model) => (
              <code key={model} className="rep-mailbox-chip">
                {model}
              </code>
            ))
          )}
          {item.providers.slice(0, 2).map((provider) => (
            <span key={provider} className="visual-pill visual-pill-neutral">
              {provider}
            </span>
          ))}
        </div>
      </td>
      <td data-label="Subject">
        {item.subject === null ? (
          <span className="muted">—</span>
        ) : (
          <code className="rep-mailbox-chip">
            {`${item.subject.kind}:${item.subject.id}`}
          </code>
        )}
      </td>
      <td data-label="Tokens" className="traces-tokens-cell">
        {item.inputTokens === null && item.outputTokens === null ? (
          <span className="muted">—</span>
        ) : (
          <div className="traces-cell-stack">
            <span>{`${formatTokenInt(item.inputTokens)} in · ${formatTokenInt(item.outputTokens)} out`}</span>
            {item.cachedInputTokens !== null && item.cachedInputTokens > 0 ? (
              <span className="traces-short-id">{`${formatTokenInt(item.cachedInputTokens)} cached`}</span>
            ) : null}
          </div>
        )}
      </td>
      <td data-label="Duration" className="mono">
        {formatValue(item.durationMs, "ms")}
      </td>
      <td data-label="Started">
        <div className="traces-cell-stack">
          <span className="mono">{ageFromEpochMs(item.startedAtMs)}</span>
          <time className="traces-short-id" dateTime={startedIso}>
            {formatShortTimestamp(item.startedAtMs)}
          </time>
        </div>
      </td>
      <td data-label="Status">
        <SeverityBadge severity={item.errorCount > 0 ? "error" : "ok"} />
      </td>
    </tr>
  );
}

function withSelectOption(
  options: readonly string[],
  current: string | undefined,
): string[] {
  return current === undefined || options.includes(current)
    ? [...options]
    : [current, ...options];
}

export function TracesFilterToolbar(props: {
  readonly baseId: string;
  readonly searchText: string;
  readonly query: TracesSearchQuery;
  readonly rangeOptions: readonly TraceRange[];
  readonly facets: TracesFacetsResponse;
  readonly onPatch: (patch: Record<string, string | undefined>) => void;
}): React.JSX.Element {
  const { baseId, searchText, query, rangeOptions, facets, onPatch } = props;
  const serviceOptions = withSelectOption(facets.services, query.service);
  const workloadOptions = withSelectOption(facets.workloads, query.workload);
  const providerOptions = withSelectOption(facets.providers, query.provider);
  const modelOptions = withSelectOption(facets.models, query.model);

  return (
    <div className="traces-filter-bar">
      <div className="traces-filter-field traces-filter-search">
        <label htmlFor={`${baseId}-q`}>Search</label>
        <div className="search">
          <SearchIcon aria-hidden="true" />
          <input
            id={`${baseId}-q`}
            type="search"
            className="input"
            placeholder="Trace ID, workload, service, subject…"
            value={searchText}
            onChange={(event) => {
              const val = event.currentTarget.value;
              onPatch({ q: val === "" ? undefined : val });
            }}
          />
        </div>
      </div>

      <div className="traces-filter-field">
        <label htmlFor={`${baseId}-range`}>Range</label>
        <select
          id={`${baseId}-range`}
          value={query.range}
          onChange={(event) => {
            onPatch({ range: event.currentTarget.value });
          }}
        >
          {rangeOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="traces-filter-field">
        <label htmlFor={`${baseId}-service`}>Service</label>
        <select
          id={`${baseId}-service`}
          value={query.service ?? ""}
          onChange={(event) => {
            const val = event.currentTarget.value;
            onPatch({ service: val === "" ? undefined : val });
          }}
        >
          <option value="">All services</option>
          {serviceOptions.map((svc) => (
            <option key={svc} value={svc}>
              {svc}
            </option>
          ))}
        </select>
      </div>

      <div className="traces-filter-field">
        <label htmlFor={`${baseId}-workload`}>Workload</label>
        <select
          id={`${baseId}-workload`}
          value={query.workload ?? ""}
          onChange={(event) => {
            const val = event.currentTarget.value;
            onPatch({ workload: val === "" ? undefined : val });
          }}
        >
          <option value="">All workloads</option>
          {workloadOptions.map((wl) => (
            <option key={wl} value={wl}>
              {wl}
            </option>
          ))}
        </select>
      </div>

      <div className="traces-filter-field">
        <label htmlFor={`${baseId}-provider`}>Provider</label>
        <select
          id={`${baseId}-provider`}
          value={query.provider ?? ""}
          onChange={(event) => {
            const val = event.currentTarget.value;
            onPatch({ provider: val === "" ? undefined : val });
          }}
        >
          <option value="">All providers</option>
          {providerOptions.map((prov) => (
            <option key={prov} value={prov}>
              {prov}
            </option>
          ))}
        </select>
      </div>

      <div className="traces-filter-field">
        <label htmlFor={`${baseId}-model`}>Model</label>
        <select
          id={`${baseId}-model`}
          value={query.model ?? ""}
          onChange={(event) => {
            const val = event.currentTarget.value;
            onPatch({ model: val === "" ? undefined : val });
          }}
        >
          <option value="">All models</option>
          {modelOptions.map((mdl) => (
            <option key={mdl} value={mdl}>
              {mdl}
            </option>
          ))}
        </select>
      </div>

      <div className="traces-filter-field">
        <label htmlFor={`${baseId}-status`}>Status</label>
        <select
          id={`${baseId}-status`}
          value={query.status}
          onChange={(event) => {
            const val = event.currentTarget.value;
            onPatch({ status: val === "all" ? undefined : val });
          }}
        >
          <option value="all">All statuses</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
        </select>
      </div>
    </div>
  );
}

export function TracesResultsTable({
  tableHeadingId,
  items,
}: {
  readonly tableHeadingId: string;
  readonly items: readonly TraceListItem[];
}): React.JSX.Element {
  const location = useLocation();
  if (items.length === 0) {
    return (
      <div className="empty-state">
        No LLM traces match the current source and filter criteria.
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby={tableHeadingId}
      className="table-wrap traces-table-wrap"
    >
      <table className="traces-table" aria-labelledby={tableHeadingId}>
        <thead>
          <tr>
            <th scope="col">Trace</th>
            <th scope="col">Service</th>
            <th scope="col">Model &amp; Provider</th>
            <th scope="col">Subject</th>
            <th scope="col">Tokens</th>
            <th scope="col">Duration</th>
            <th scope="col">Started</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <TraceRow
              key={item.traceId}
              item={item}
              fromSearch={location.search}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
