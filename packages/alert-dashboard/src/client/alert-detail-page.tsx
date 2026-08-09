import { Temporal } from "@js-temporal/polyfill";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";

import { occurrencePreviewRange } from "./preview-range.ts";
import { formatInstant } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { Button } from "#components/button";
import {
  AlertOccurrenceIdSchema,
  type AlertDetail,
  type Previews,
} from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";

function Preview({
  title,
  value,
}: {
  title: string;
  value: Previews["prometheus"];
}): React.JSX.Element {
  return (
    <section className="preview">
      <div className="preview-heading">
        <h2>{title}</h2>
        <span className={`preview-status ${value.status}`}>{value.status}</span>
      </div>
      {value.status === "available" ? (
        <>
          <code>{value.query}</code>
          <pre>{JSON.stringify(value.data, null, 2)}</pre>
        </>
      ) : (
        <p>{value.reason}</p>
      )}
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
  if (alert.isPending)
    return (
      <main>
        <div className="loading-state">Loading alert…</div>
      </main>
    );
  if (alert.isError)
    return (
      <main>
        <div className="error-state">Alert not found.</div>
      </main>
    );
  const value = alert.data.pages[0];
  if (value === undefined) throw new Error("Alert detail page was empty");
  const deliveries = alert.data.pages.flatMap((page) => page.deliveries);
  const dashboardUrl = value.annotations["dashboard_url"];
  const runbookUrl = value.annotations["runbook_url"];
  return (
    <main>
      <title>{`${value.alertname} · Alerts`}</title>
      <Link className="back-link" to="/">
        <ArrowLeftIcon /> Active alerts
      </Link>
      <div className="detail-heading">
        <div>
          <div className="badge-row">
            <span className={`severity severity-${value.severity}`}>
              {value.severity}
            </span>
            <span className="state">{value.lifecycleState}</span>
            {value.suppressionState === "none" ? null : (
              <span className="suppression">{value.suppressionState}</span>
            )}
          </div>
          <h1>{value.alertname}</h1>
          <p>{value.summary}</p>
        </div>
        <div className="link-row">
          {runbookUrl === undefined ? null : (
            <a href={runbookUrl} rel="noreferrer" target="_blank">
              Runbook <ExternalLinkIcon />
            </a>
          )}
          {dashboardUrl === undefined ? null : (
            <a href={dashboardUrl} rel="noreferrer" target="_blank">
              Dashboard <ExternalLinkIcon />
            </a>
          )}
          {value.generatorUrl === null ? null : (
            <a href={value.generatorUrl} rel="noreferrer" target="_blank">
              Source <ExternalLinkIcon />
            </a>
          )}
        </div>
      </div>
      <div className="detail-grid">
        <section className="panel metadata">
          <h2>Metadata</h2>
          <dl>
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
          <h3>Labels</h3>
          <div className="label-list">
            {Object.entries(value.labels).map(([key, label]) => (
              <code key={key}>
                {key}={label}
              </code>
            ))}
          </div>
          <h3>Annotations</h3>
          <div className="label-list">
            {Object.entries(value.annotations).map(([key, annotation]) => (
              <code key={key}>
                {key}={annotation}
              </code>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2 className="section-heading">Lifecycle</h2>
          <div className="timeline compact">
            {value.events.map((event) => (
              <article key={event.id}>
                <span className="timeline-dot" />
                <div>
                  <strong>{event.type.replaceAll("_", " ")}</strong>
                  <p>{event.source}</p>
                  <time className="mono" dateTime={event.occurredAt}>
                    {formatInstant(event.occurredAt)}
                  </time>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2 className="section-heading">Webhook evidence</h2>
          {deliveries.length === 0 ? (
            <p>
              No webhook delivery observed for this occurrence. It may have been
              discovered by reconciliation.
            </p>
          ) : (
            <div className="timeline compact">
              {deliveries.map((delivery) => (
                <article key={delivery.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>
                      {delivery.status} · {delivery.receiver}
                    </strong>
                    <p className="mono">{delivery.groupKey}</p>
                    <time className="mono" dateTime={delivery.receivedAt}>
                      {formatInstant(delivery.receivedAt)}
                    </time>
                    <p className="mono">
                      sha256:{delivery.payloadHash.slice(0, 12)} · raw{" "}
                      {delivery.rawPayloadRetained ? "retained" : "expired"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
          {alert.hasNextPage ? (
            <Button
              disabled={alert.isFetchingNextPage}
              onClick={() => void alert.fetchNextPage()}
              type="button"
            >
              {alert.isFetchingNextPage
                ? "Loading evidence…"
                : "Load more evidence"}
            </Button>
          ) : null}
        </section>
      </div>
      <div className="previews">
        <h2>Observability previews</h2>
        {previews.isPending ? (
          <div className="loading-state">Loading bounded previews…</div>
        ) : previews.isError ? (
          <div className="error-state">
            Previews are unavailable; alert details remain available.
          </div>
        ) : (
          <div className="preview-grid">
            <Preview title="Prometheus" value={previews.data.prometheus} />
            <Preview title="Loki" value={previews.data.loki} />
            <Preview title="Tempo" value={previews.data.tempo} />
          </div>
        )}
      </div>
    </main>
  );
}

export function AlertDetailPage(): React.JSX.Element {
  const route = useParams();
  const id = AlertOccurrenceIdSchema.safeParse(route["id"]);
  if (id.success) return <AlertDetailContent id={id.data} />;
  return (
    <main>
      <title>Alert not found · Alerts</title>
      <div className="error-state">Alert not found.</div>
    </main>
  );
}
