import { AlertSeverity } from "#client/ledger-severity.tsx";
import { SeveritySchema } from "#shared/schema";
import { pillSeverity } from "#client/visuals/pill.ts";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router";

import { PageHeading } from "#client/ops/ops-ui.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { DataTable, type DataTableColumn } from "#client/visuals/index.ts";
import type {
  IncidentMailDetail,
  IncidentMailOccurrence,
} from "#shared/reports-schema";
import "#styles/engineering.css";
import "#styles/reports.css";
import "#styles/visuals.css";

import { EmailPreviewPanel } from "./email-preview-panel.tsx";
import { incidentMailDetailQuery, isReportsNotFound } from "./reports-api.ts";
import {
  deliveryStatusMeta,
  formatPacificFull,
  formatPacificShort,
} from "./reports-format.ts";

const OCCURRENCE_COLUMNS: readonly DataTableColumn<IncidentMailOccurrence>[] = [
  {
    key: "alertname",
    header: "Alert",
    sortValue: (occ) => occ.alertname,
    render: (occ) => (
      <div className="eng-pkg-cell">
        <Link className="rep-feed-subject-link mono" to={`/alerts/${occ.id}`}>
          {occ.alertname}
        </Link>
        <span className="rep-cell-sub mono">{occ.id}</span>
      </div>
    ),
  },
  {
    key: "severity",
    header: "Severity",
    sortValue: (occ) => occ.severity,
    render: (occ) => {
      // The outbox records the severity as text; a ledger severity reads as
      // the ledger's glyph and word, anything else as recorded.
      const parsed = SeveritySchema.safeParse(occ.severity);
      return parsed.success ? (
        <AlertSeverity severity={parsed.data} />
      ) : (
        occ.severity
      );
    },
  },
  {
    key: "lifecycle",
    header: "State",
    sortValue: (occ) => occ.lifecycleState,
    render: (occ) => <span className="state">{occ.lifecycleState}</span>,
  },
  {
    key: "summary",
    header: "Summary",
    render: (occ) => <p className="eng-summary-clamp">{occ.summary}</p>,
  },
  {
    key: "openedAt",
    header: "Opened",
    sortValue: (occ) => occ.openedAt,
    render: (occ) => (
      <time className="mono" dateTime={occ.openedAt}>
        {formatPacificShort(occ.openedAt)}
      </time>
    ),
  },
];

export function IncidentMailBody({
  detail,
}: {
  readonly detail: IncidentMailDetail;
}): React.JSX.Element {
  const statusMeta = deliveryStatusMeta(detail.status);

  return (
    <>
      <Link className="back-link" to="/reports?tab=incidents">
        <ArrowLeftIcon aria-hidden="true" /> Reports · Incident mail
      </Link>

      <div className="rep-heading-badges">
        <span className="visual-pill" data-sev={pillSeverity(statusMeta.tone)}>
          {statusMeta.label}
        </span>
        <code className="rep-mailbox-chip">{detail.mailboxTo}</code>
        <span className="visual-pill">
          {String(detail.attemptCount)} attempt
          {detail.attemptCount === 1 ? "" : "s"}
        </span>
      </div>

      <PageHeading meta="Incident alert email" title={detail.subject} />

      <section
        className="panel rep-section-panel"
        aria-labelledby="incident-mail-meta-heading"
      >
        <h2 className="rep-panel-title" id="incident-mail-meta-heading">
          Outbox &amp; delivery metadata
        </h2>
        <dl className="rep-meta-grid">
          <div>
            <dt>Outbox ID</dt>
            <dd className="mono">{detail.id}</dd>
          </div>
          <div>
            <dt>Message ID</dt>
            <dd className="mono">{detail.messageId}</dd>
          </div>
          <div>
            <dt>Mailbox routing</dt>
            <dd className="mono">
              {detail.mailboxFrom} → {detail.mailboxTo}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span
                className="visual-pill"
                data-sev={pillSeverity(statusMeta.tone)}
              >
                {statusMeta.label}
              </span>
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd className="mono">{formatPacificFull(detail.createdAt)}</dd>
          </div>
          <div>
            <dt>Sent</dt>
            <dd className="mono">{formatPacificFull(detail.sentAt)}</dd>
          </div>
          <div>
            <dt>Delivery attempts</dt>
            <dd className="mono">{String(detail.attemptCount)}</dd>
          </div>
          {detail.canceledAt === null ? null : (
            <div>
              <dt>Canceled</dt>
              <dd className="mono">
                {formatPacificFull(detail.canceledAt)}
                {detail.canceledBy === null ? "" : ` by ${detail.canceledBy}`}
              </dd>
            </div>
          )}
          {detail.cancellationReason === null ? null : (
            <div>
              <dt>Cancellation reason</dt>
              <dd>{detail.cancellationReason}</dd>
            </div>
          )}
          {detail.lastError === null ? null : (
            <div>
              <dt>Last error</dt>
              <dd className="mono">{detail.lastError}</dd>
            </div>
          )}
        </dl>
      </section>

      <section
        className="rep-feed-section"
        aria-labelledby="incident-occurrences-heading"
      >
        <h2 className="block-heading" id="incident-occurrences-heading">
          Linked alert occurrences{" "}
          <span className="eng-tab-count">{detail.occurrences.length}</span>
        </h2>
        <DataTable
          caption="Alert occurrences linked to this incident email"
          hideCaption
          rows={detail.occurrences}
          rowKey={(occ) => occ.id}
          rowLabel={(occ) => occ.alertname}
          columns={OCCURRENCE_COLUMNS}
          initialCap={25}
          emptyMessage="No retained alert occurrences are linked to this outbox item."
        />
      </section>

      <EmailPreviewPanel
        htmlBody={detail.htmlBody}
        plainBody={detail.plainBody}
      />
    </>
  );
}

function IncidentMailLoader({
  id,
}: {
  readonly id: string;
}): React.JSX.Element {
  const detail = Loaded.fromQuery(useQuery(incidentMailDetailQuery(id)));
  return (
    <main className="rep-detail-page">
      <title>Incident mail · Hub</title>
      <LoadingBlock
        values={{ detail }}
        fallback={<div className="loading-state">Loading incident mail…</div>}
        renderError={(errors) =>
          isReportsNotFound(errors[0].error) ? (
            <div className="empty-state">Incident mail item not found.</div>
          ) : (
            <div className="error-state">Incident mail is unavailable.</div>
          )
        }
      >
        {({ detail: value }, meta) => (
          <>
            <title>{`${value.subject} · Hub`}</title>
            <StaleNotice errors={meta.errors} />
            <IncidentMailBody detail={value} />
          </>
        )}
      </LoadingBlock>
    </main>
  );
}

export function IncidentMailPage(): React.JSX.Element {
  const params = useParams();
  const id = params["id"]?.trim();
  if (id === undefined || id.length === 0) {
    return (
      <main>
        <title>Incident mail not found · Hub</title>
        <div className="empty-state">Incident mail item not found.</div>
      </main>
    );
  }
  return <IncidentMailLoader id={id} />;
}
