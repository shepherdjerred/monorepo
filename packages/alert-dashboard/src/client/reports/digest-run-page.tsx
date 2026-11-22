import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import {
  DigestKindSchema,
  type DigestKind,
} from "@shepherdjerred/ops-model/digest.ts";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRightIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  MinusIcon,
} from "lucide-react";
import { useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import {
  ChangeTimeline,
  PageHeading,
  StatusBanner,
} from "#client/ops/ops-ui.tsx";
import { SignalList } from "#client/ops/signal-list.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { formatDelta, formatValue, trendDelta } from "#shared/ops-format";
import type { Trend } from "#shared/ops-schema";
import type { DigestRunDetail } from "#shared/reports-schema";
import "#styles/engineering.css";
import "#styles/reports.css";
import "#styles/visuals.css";

import { EmailPreviewPanel } from "./email-preview-panel.tsx";
import { digestRunDetailQuery, isReportsNotFound } from "./reports-api.ts";
import {
  deliveryStatusMeta,
  formatPacificFull,
  nextRovingTabIndex,
  parseDetailViewMode,
  type DetailViewMode,
} from "./reports-format.ts";

const VIEW_TABS: readonly {
  readonly id: DetailViewMode;
  readonly label: string;
}[] = [
  { id: "inspector", label: "Inspector" },
  { id: "email", label: "Rendered Email" },
];

function TrendRow({ trend }: { readonly trend: Trend }): React.JSX.Element {
  const delta = trendDelta(trend);
  const direction =
    delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const good =
    direction === "flat" ? null : (direction === "up") === trend.higherIsBetter;
  const Icon =
    direction === "up"
      ? ArrowUpRightIcon
      : direction === "down"
        ? ArrowDownRightIcon
        : MinusIcon;
  return (
    <tr>
      <th scope="row">{trend.label}</th>
      <td className="num">{formatValue(trend.current, trend.unit)}</td>
      <td className="num muted">{formatValue(trend.previous, trend.unit)}</td>
      <td
        className={`num delta ${good === null ? "delta-flat" : good ? "delta-good" : "delta-bad"}`}
      >
        <Icon aria-hidden="true" /> {formatDelta(delta, trend.unit)}
      </td>
    </tr>
  );
}

export function DigestRunBody({
  detail,
}: {
  readonly detail: DigestRunDetail;
}): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const viewMode = parseDetailViewMode(params.get("view"));
  const tabRefs = useRef(new Map<DetailViewMode, HTMLButtonElement>());
  const statusMeta = deliveryStatusMeta(detail.status);
  const { report } = detail;

  const setView = (next: DetailViewMode) => {
    const updated = new URLSearchParams(params);
    if (next === "inspector") {
      updated.delete("view");
    } else {
      updated.set("view", next);
    }
    setParams(updated, { replace: true });
  };

  return (
    <>
      <Link className="back-link" to="/reports?tab=digests">
        <ArrowLeftIcon aria-hidden="true" /> Reports · Digests
      </Link>

      <div className="rep-heading-badges">
        <span className={`visual-pill visual-pill-${statusMeta.tone}`}>
          {statusMeta.label}
        </span>
        {detail.skipReason === undefined ? null : (
          <span className="visual-pill visual-pill-neutral">
            {detail.skipReason}
          </span>
        )}
        <code className="rep-mailbox-chip">{detail.periodKey}</code>
        <code className="rep-mailbox-chip">{detail.mailboxTo}</code>
      </div>

      <PageHeading
        eyebrow={
          detail.kind === "weekly"
            ? "Weekly operations review"
            : "Daily operations digest"
        }
        title={detail.subject}
      />

      <div
        role="tablist"
        aria-label="Digest detail view"
        className="eng-tablist"
      >
        {VIEW_TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`digest-view-tab-${tab.id}`}
            ref={(node) => {
              if (node === null) {
                tabRefs.current.delete(tab.id);
              } else {
                tabRefs.current.set(tab.id, node);
              }
            }}
            role="tab"
            type="button"
            className="eng-tab"
            aria-selected={viewMode === tab.id}
            tabIndex={viewMode === tab.id ? 0 : -1}
            onClick={() => {
              setView(tab.id);
            }}
            onKeyDown={(event) => {
              const nextIdx = nextRovingTabIndex(
                event.key,
                index,
                VIEW_TABS.length,
              );
              const nextTab = nextIdx === null ? undefined : VIEW_TABS[nextIdx];
              if (nextTab !== undefined) {
                event.preventDefault();
                setView(nextTab.id);
                tabRefs.current.get(nextTab.id)?.focus();
              }
            }}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`digest-view-panel-${viewMode}`}
        aria-labelledby={`digest-view-tab-${viewMode}`}
        className="rep-detail-page"
      >
        {viewMode === "email" ? (
          <EmailPreviewPanel
            htmlBody={detail.htmlBody}
            plainBody={detail.plainBody}
            metadata={[
              { label: "Status", value: statusMeta.label, mono: false },
              {
                label: "From → To",
                value: `${detail.mailboxFrom} → ${detail.mailboxTo}`,
              },
              {
                label: "Period",
                value: `${detail.kind} · ${detail.periodKey}`,
              },
              {
                label: "Sent at",
                value: formatPacificFull(detail.sentAt),
              },
            ]}
          />
        ) : (
          <>
            <StatusBanner
              severity={report.status.severity}
              summary={report.status.summary}
              label="Digest period status"
            >
              {formatPacificFull(report.periodStart)} –{" "}
              {formatPacificFull(report.periodEnd)}
              {report.status.stale ? " · stale snapshot" : ""}
            </StatusBanner>

            <div className="review-grid">
              {report.trends.length === 0 ? null : (
                <section
                  className="panel"
                  aria-labelledby="digest-trends-heading"
                >
                  <header className="panel-heading">
                    <h2 id="digest-trends-heading">
                      Compared with the previous week
                    </h2>
                  </header>
                  <div className="table-scroll">
                    <table className="trend-table">
                      <thead>
                        <tr>
                          <th scope="col">Measure</th>
                          <th scope="col" className="num">
                            This week
                          </th>
                          <th scope="col" className="num">
                            Previous
                          </th>
                          <th scope="col" className="num">
                            Change
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.trends.map((trend) => (
                          <TrendRow key={trend.id} trend={trend} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section
                className="panel incident-panel"
                aria-labelledby="digest-incidents-heading"
              >
                <header className="panel-heading">
                  <h2 id="digest-incidents-heading">Incidents</h2>
                </header>
                <div className="metric-row">
                  <div className="metric">
                    <span>Opened</span>
                    <strong>{report.incidents.opened}</strong>
                  </div>
                  <div className="metric">
                    <span>Resolved</span>
                    <strong>{report.incidents.resolved}</strong>
                  </div>
                  <div className="metric">
                    <span>Median to resolve</span>
                    <strong>
                      {report.incidents.medianMinutesToResolve === null
                        ? "—"
                        : `${String(Math.round(report.incidents.medianMinutesToResolve))}m`}
                    </strong>
                  </div>
                </div>
              </section>
            </div>

            <div className="rep-two-col">
              <section
                className="panel list-panel"
                aria-labelledby="digest-needs-me"
              >
                <header className="panel-heading">
                  <h2 id="digest-needs-me">
                    Needs your review{" "}
                    <span className="count">{report.needsMe.length}</span>
                  </h2>
                </header>
                <SignalList
                  signals={report.needsMe}
                  empty="Nothing waiting on your review."
                />
              </section>

              <section
                className="panel list-panel"
                aria-labelledby="digest-attention"
              >
                <header className="panel-heading">
                  <h2 id="digest-attention">
                    Attention{" "}
                    <span className="count">{report.attention.length}</span>
                  </h2>
                </header>
                <SignalList
                  signals={report.attention}
                  empty="Zero attention signals."
                />
              </section>
            </div>

            <div className="rep-two-col">
              <section
                className="panel list-panel"
                aria-labelledby="digest-new-since"
              >
                <header className="panel-heading">
                  <h2 id="digest-new-since">
                    {report.kind === "daily"
                      ? "New since the last digest"
                      : "New this period"}{" "}
                    <span className="count">{report.newSinceLast.length}</span>
                  </h2>
                </header>
                <SignalList
                  signals={report.newSinceLast}
                  empty="Nothing new."
                />
              </section>

              <section
                className="panel list-panel"
                aria-labelledby="digest-changes"
              >
                <header className="panel-heading">
                  <h2 id="digest-changes">Changes</h2>
                </header>
                <ChangeTimeline changes={report.changes} />
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function DigestRunLoader(p: {
  readonly kind: DigestKind;
  readonly periodKey: string;
}): React.JSX.Element {
  const detail = Loaded.fromQuery(
    useQuery(digestRunDetailQuery(p.kind, p.periodKey)),
  );
  return (
    <main className="rep-detail-page">
      <title>Digest · Hub</title>
      <LoadingBlock
        values={{ detail }}
        fallback={<div className="loading-state">Loading digest…</div>}
        renderError={(errors) =>
          isReportsNotFound(errors[0].error) ? (
            <div className="empty-state">Digest archive not found.</div>
          ) : (
            <div className="error-state">Digest archive is unavailable.</div>
          )
        }
      >
        {({ detail: value }, meta) => (
          <>
            <title>{`${value.subject} · Hub`}</title>
            <StaleNotice errors={meta.errors} />
            <DigestRunBody detail={value} />
          </>
        )}
      </LoadingBlock>
    </main>
  );
}

export function DigestRunPage(): React.JSX.Element {
  const params = useParams();
  const kindParsed = DigestKindSchema.safeParse(params["kind"]);
  const periodKey = params["periodKey"]?.trim();
  if (
    periodKey === undefined ||
    periodKey.length === 0 ||
    !kindParsed.success
  ) {
    return (
      <main>
        <title>Digest not found · Hub</title>
        <div className="empty-state">Digest archive not found.</div>
      </main>
    );
  }
  return <DigestRunLoader kind={kindParsed.data} periodKey={periodKey} />;
}
