import { Temporal } from "@js-temporal/polyfill";
import { Button, StatusGlyph, type Severity } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { z } from "zod";

import { occurrencePreviewRange } from "./preview-range.ts";
import { StaleNotice } from "./stale-notice.tsx";
import { formatInstant } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { UplotChart, type ChartSeries } from "#client/charts/uplot-chart.tsx";
import {
  AlertOccurrenceIdSchema,
  type AlertDetail,
  type Previews,
} from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";
import { AlertSeverity } from "./ledger-severity.tsx";
import { PageHeading } from "./ops/ops-ui.tsx";

/** A preview's status as a glyph and its word. */
const PREVIEW_STATUS: Readonly<
  Record<
    Previews["prometheus"]["status"],
    { readonly tone: Severity; readonly label: string }
  >
> = {
  available: { tone: "ok", label: "Available" },
  error: { tone: "error", label: "Error" },
  unavailable: { tone: "unknown", label: "Unavailable" },
};

const PrometheusMatrixBodySchema = z.object({
  resultType: z.literal("matrix"),
  result: z.array(
    z.object({
      metric: z.record(z.string(), z.string()),
      values: z.array(z.tuple([z.number(), z.string()])),
    }),
  ),
});

const PrometheusMatrixEnvelopeSchema = z.union([
  PrometheusMatrixBodySchema,
  z
    .object({ data: PrometheusMatrixBodySchema })
    .transform((envelope) => envelope.data),
]);

function formatMetricName(
  metric: Readonly<Record<string, string>>,
  fallbackIndex: number,
): string {
  const entries = Object.entries(metric).filter(([key]) => key !== "__name__");
  return entries.length > 0
    ? entries.map(([key, val]) => `${key}="${val}"`).join(", ")
    : (metric["__name__"] ?? `series ${String(fallbackIndex + 1)}`);
}

export function parsePrometheusMatrixSeries(
  raw: unknown,
): readonly ChartSeries[] | null {
  const parsed = PrometheusMatrixEnvelopeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.result.length === 0) return null;
  const usedNames = new Set<string>();
  const series: ChartSeries[] = [];
  for (const [index, entry] of parsed.data.result.entries()) {
    const points: [number, number][] = [];
    for (const [timestamp, rawValue] of entry.values) {
      const numeric = Number(rawValue);
      if (Number.isFinite(timestamp) && Number.isFinite(numeric))
        points.push([timestamp, numeric]);
    }
    if (points.length === 0) continue;
    const baseName = formatMetricName(entry.metric, index);
    const name = usedNames.has(baseName)
      ? `${baseName} (${String(index + 1)})`
      : baseName;
    usedNames.add(name);
    series.push({ name, points });
  }
  return series.length > 0 ? series : null;
}

export function deduplicatedAnnotations(
  annotations: Readonly<Record<string, string>>,
  alertSummary: string,
): readonly (readonly [string, string])[] {
  const summaryText = annotations["summary"]?.trim();
  const normalizedAlertSummary = alertSummary.trim();
  return Object.entries(annotations).filter(([key, value]) => {
    if (key !== "description") return true;
    const trimmed = value.trim();
    return trimmed !== summaryText && trimmed !== normalizedAlertSummary;
  });
}

export function Preview({
  title,
  value,
  enablePrometheusChart = false,
}: {
  title: string;
  value: Previews["prometheus"];
  enablePrometheusChart?: boolean;
}): React.JSX.Element {
  const matrixSeries =
    enablePrometheusChart && value.status === "available"
      ? parsePrometheusMatrixSeries(value.data)
      : null;
  return (
    <section className="preview chart-panel">
      <div className="preview-heading">
        <h3>{title}</h3>
        <StatusGlyph
          severity={PREVIEW_STATUS[value.status].tone}
          label={PREVIEW_STATUS[value.status].label}
        />
      </div>
      {value.status === "available" ? (
        <>
          <code>{value.query}</code>
          {matrixSeries === null ? (
            <pre>{JSON.stringify(value.data, null, 2)}</pre>
          ) : (
            <>
              <div className="query-chart">
                <UplotChart
                  height={200}
                  label={`${title}: ${value.query}`}
                  series={matrixSeries}
                  unit="count"
                />
              </div>
              <details className="query-raw">
                <summary className="query-raw-summary">
                  Raw Prometheus JSON
                </summary>
                <pre>{JSON.stringify(value.data, null, 2)}</pre>
              </details>
            </>
          )}
        </>
      ) : (
        <p>{value.reason}</p>
      )}
    </section>
  );
}

function AlertMetadataPanel({
  value,
}: {
  readonly value: AlertDetail;
}): React.JSX.Element {
  const annotations = deduplicatedAnnotations(value.annotations, value.summary);
  return (
    <section className="ledger-section" aria-labelledby="metadata-heading">
      <header className="ui-section-head">
        <h2 className="ui-section-title" id="metadata-heading">
          Metadata
        </h2>
      </header>
      <dl className="def-table">
        <div>
          <dt>Fingerprint</dt>
          <dd className="mono">{value.fingerprint}</dd>
        </div>
        <div>
          <dt>Namespace</dt>
          <dd className="mono">{value.namespace ?? "—"}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd className="mono">{formatInstant(value.openedAt)}</dd>
        </div>
        <div>
          <dt>Resolved</dt>
          <dd className="mono">{formatInstant(value.resolvedAt)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd className="mono">{formatInstant(value.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Resolution source</dt>
          <dd>{value.resolutionSource ?? "—"}</dd>
        </div>
      </dl>
      <h3 className="def-subhead">Labels</h3>
      <div className="label-list">
        {Object.entries(value.labels).map(([key, label]) => (
          <code key={key}>
            {key}={label}
          </code>
        ))}
      </div>
      <h3 className="def-subhead">Annotations</h3>
      <div className="label-list">
        {annotations.map(([key, annotation]) => (
          <code key={key}>
            {key}={annotation}
          </code>
        ))}
      </div>
    </section>
  );
}

function AlertDetailContent({
  id,
}: {
  id: AlertDetail["id"];
}): React.JSX.Element {
  const trpc = useTRPC();
  const alert = useInfiniteQuery(
    trpc.alerts.byId.infiniteQueryOptions(
      { id, limit: 100 },
      { getNextPageParam: (lastPage) => lastPage.deliveriesNextCursor },
    ),
  );
  const now = useMemo(() => Temporal.Now.instant(), []);
  const range =
    alert.data?.pages[0] === undefined
      ? occurrencePreviewRange(
          {
            openedAt: epochNanosecondsToInstantText(
              now.subtract({ minutes: 5 }).epochNanoseconds,
            ),
            resolvedAt: null,
          },
          now,
        )
      : occurrencePreviewRange(alert.data.pages[0], now);
  const previewInput = {
    id,
    ...range,
  };
  const previews = useQuery({
    ...trpc.previews.get.queryOptions(previewInput),
    enabled: alert.data?.pages[0] !== undefined,
  });
  const alertValue = Loaded.fromQuery(alert, ["alert"]);
  const previewsValue = Loaded.fromQuery(previews, ["previews"]);
  return (
    <LoadingBlock
      values={{ alert: alertValue }}
      fallback={
        <main>
          <div className="loading-state">Loading alert…</div>
        </main>
      }
      renderError={() => (
        <main>
          <div className="error-state">Alert not found.</div>
        </main>
      )}
    >
      {({ alert: loadedAlert }, meta) => {
        const value = loadedAlert.pages[0];
        if (value === undefined) throw new Error("Alert detail page was empty");
        const deliveries = loadedAlert.pages.flatMap((page) => page.deliveries);
        const dashboardUrl = value.annotations["dashboard_url"];
        const runbookUrl = value.annotations["runbook_url"];
        const isHouse = value.labels["category"] === "household";
        return (
          <main className="ledger alert-detail">
            <title>{`${value.alertname} · Hub`}</title>
            <StaleNotice errors={meta.errors} />
            <PageHeading title={value.alertname} meta={value.summary}>
              <AlertSeverity severity={value.severity} />
              <span className="state">{value.lifecycleState}</span>
              {value.suppressionState === "none" ? null : (
                <span className="suppression">{value.suppressionState}</span>
              )}
              {runbookUrl === undefined ? null : (
                <a
                  className="ui-btn"
                  href={runbookUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Runbook <ExternalLinkIcon aria-hidden="true" />
                </a>
              )}
              {dashboardUrl === undefined ? null : (
                <a
                  className="ui-btn"
                  href={dashboardUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Dashboard <ExternalLinkIcon aria-hidden="true" />
                </a>
              )}
              {value.generatorUrl === null ? null : (
                <a
                  className="ui-btn"
                  href={value.generatorUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Source <ExternalLinkIcon aria-hidden="true" />
                </a>
              )}
            </PageHeading>
            <div className="ledger-body">
              <Link className="back-link" to={isHouse ? "/house" : "/alerts"}>
                <ArrowLeftIcon aria-hidden="true" />{" "}
                {isHouse ? "House" : "Active alerts"}
              </Link>
              <div className="detail-grid">
                <AlertMetadataPanel value={value} />
                <section
                  className="ledger-section"
                  aria-labelledby="lifecycle-heading"
                >
                  <header className="ui-section-head">
                    <h2 className="ui-section-title" id="lifecycle-heading">
                      Lifecycle
                    </h2>
                  </header>
                  <div className="ui-table-scroll">
                    <table
                      className="ui-table"
                      aria-labelledby="lifecycle-heading"
                    >
                      <thead>
                        <tr>
                          <th scope="col">When</th>
                          <th scope="col">Event</th>
                          <th scope="col">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {value.events.map((event) => (
                          <tr key={event.id}>
                            <td className="mono">
                              <time dateTime={event.occurredAt}>
                                {formatInstant(event.occurredAt)}
                              </time>
                            </td>
                            <th scope="row">
                              {event.type.replaceAll("_", " ")}
                            </th>
                            <td>{event.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
              <section
                className="ledger-section"
                aria-labelledby="evidence-heading"
              >
                <header className="ui-section-head">
                  <h2 className="ui-section-title" id="evidence-heading">
                    Webhook evidence
                  </h2>
                </header>
                {deliveries.length === 0 ? (
                  <p className="ledger-note">
                    No webhook delivery observed for this occurrence. It may
                    have been discovered by reconciliation.
                  </p>
                ) : (
                  <div className="ui-table-scroll">
                    <table
                      className="ui-table"
                      aria-labelledby="evidence-heading"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Received</th>
                          <th scope="col">Delivery</th>
                          <th scope="col">Group key</th>
                          <th scope="col">Payload</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveries.map((delivery) => (
                          <tr key={delivery.id}>
                            <td className="mono">
                              <time dateTime={delivery.receivedAt}>
                                {formatInstant(delivery.receivedAt)}
                              </time>
                            </td>
                            <th scope="row">
                              {delivery.status} · {delivery.receiver}
                            </th>
                            <td className="mono evidence-key">
                              {delivery.groupKey}
                            </td>
                            <td className="mono">
                              sha256:{delivery.payloadHash.slice(0, 12)} · raw{" "}
                              {delivery.rawPayloadRetained
                                ? "retained"
                                : "expired"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {alert.hasNextPage ? (
                  <div className="ui-section-foot">
                    <Button
                      disabled={alert.isFetchingNextPage}
                      onClick={() => void alert.fetchNextPage()}
                    >
                      {alert.isFetchingNextPage
                        ? "Loading evidence…"
                        : "Load more evidence"}
                    </Button>
                  </div>
                ) : null}
              </section>
              <section className="previews" aria-labelledby="previews-heading">
                <header className="ui-section-head">
                  <h2 className="ui-section-title" id="previews-heading">
                    Observability previews
                  </h2>
                </header>
                {Loaded.match(previewsValue, {
                  loading: () => (
                    <div className="loading-state">
                      Loading bounded previews…
                    </div>
                  ),
                  error: () => (
                    <div className="error-state">
                      Previews are unavailable; alert details remain available.
                    </div>
                  ),
                  available: (data, previewMeta) => (
                    <>
                      {/*
                      The previews are their own dependency: the outer
                      LoadingBlock joins only `alertValue`, so a failed preview
                      refetch over cached previews is invisible to the page's
                      StaleNotice. Without this the old Prometheus/Loki/Tempo
                      values read as current.
                    */}
                      <StaleNotice errors={previewMeta.errors} />
                      <div className="preview-grid">
                        <Preview
                          enablePrometheusChart
                          title="Prometheus"
                          value={data.prometheus}
                        />
                        <Preview title="Loki" value={data.loki} />
                        <Preview title="Tempo" value={data.tempo} />
                      </div>
                    </>
                  ),
                })}
              </section>
            </div>
          </main>
        );
      }}
    </LoadingBlock>
  );
}

export function AlertDetailPage(): React.JSX.Element {
  const route = useParams();
  const id = AlertOccurrenceIdSchema.safeParse(route["id"]);
  if (id.success) return <AlertDetailContent id={id.data} />;
  return (
    <main>
      <title>Alert not found · Hub</title>
      <div className="error-state">Alert not found.</div>
    </main>
  );
}
