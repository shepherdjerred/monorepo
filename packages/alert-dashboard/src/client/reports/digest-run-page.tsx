import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import {
  DigestKindSchema,
  type DigestKind,
} from "@shepherdjerred/ops-model/digest.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router";

import {
  ChangeTimeline,
  IncidentPanel,
  PageHeading,
  StatusBanner,
  TrendPanel,
} from "#client/ops/ops-ui.tsx";
import { SignalList } from "#client/ops/signal-list.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import type { DigestRunDetail } from "#shared/reports-schema";
import "#styles/engineering.css";
import "#styles/reports.css";
import "#styles/visuals.css";

import {
  DetailViewTabs,
  EmailPreviewPanel,
  useDetailViewMode,
} from "./email-preview-panel.tsx";
import { digestRunDetailQuery, isReportsNotFound } from "./reports-api.ts";
import { deliveryStatusMeta, formatPacificFull } from "./reports-format.ts";

export function DigestRunBody({
  detail,
}: {
  readonly detail: DigestRunDetail;
}): React.JSX.Element {
  const { viewMode, setView } = useDetailViewMode();
  const statusMeta = deliveryStatusMeta(detail.status);
  const { report } = detail;

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

      <DetailViewTabs
        ariaLabel="Digest detail view"
        idPrefix="digest-view"
        viewMode={viewMode}
        onSelect={setView}
      />

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
                <TrendPanel
                  trends={report.trends}
                  headingId="digest-trends-heading"
                />
              )}
              <IncidentPanel
                incidents={report.incidents}
                headingId="digest-incidents-heading"
              />
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
