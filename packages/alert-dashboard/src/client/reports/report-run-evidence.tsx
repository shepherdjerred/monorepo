import { pillSeverity } from "#client/visuals/pill.ts";
import type { ReportEvidenceReceiptV1 } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import { ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";

import type { ReportRunDetail } from "#shared/reports-schema";

import {
  deliveryStatusMeta,
  formatDuration,
  formatPacificFull,
  formatPacificShort,
  verdictLabel,
} from "./reports-format.ts";

function ReceiptItem(p: {
  readonly receipt: ReportEvidenceReceiptV1;
  readonly highlighted: boolean;
}): React.JSX.Element {
  const { receipt, highlighted } = p;
  return (
    <li
      id={`receipt-${receipt.id}`}
      className={`rep-receipt-card${highlighted ? " rep-receipt-highlighted" : ""}`}
    >
      <div className="rep-card-top">
        <div className="eng-pill-row">
          <code className="visual-branch-chip">#{receipt.id}</code>
          <span
            className="visual-pill"
            data-sev={pillSeverity(
              receipt.status === "success" ? "ok" : "error",
            )}
          >
            {receipt.status}
          </span>
          {receipt.semanticStatus === undefined ? null : (
            <span
              className="visual-pill"
              data-sev={pillSeverity(
                receipt.semanticStatus === "passed" ? "ok" : "warning",
              )}
            >
              predicate: {receipt.semanticStatus}
            </span>
          )}
          {receipt.origin === undefined ? null : (
            <span className="visual-pill">{receipt.origin}</span>
          )}
        </div>
        {receipt.url === undefined ? null : (
          <a
            className="eng-ext-link"
            href={receipt.url}
            target="_blank"
            rel="noreferrer"
          >
            View source
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        )}
      </div>

      <dl className="rep-meta-grid">
        <div>
          <dt>Source</dt>
          <dd className="mono">{receipt.source}</dd>
        </div>
        <div>
          <dt>Observed at</dt>
          <dd className="mono">{formatPacificFull(receipt.observedAt)}</dd>
        </div>
        {receipt.exitCode === undefined ? null : (
          <div>
            <dt>Exit code</dt>
            <dd className="mono">{String(receipt.exitCode)}</dd>
          </div>
        )}
        {receipt.contentSha256 === undefined ? null : (
          <div>
            <dt>SHA-256</dt>
            <dd className="mono">{receipt.contentSha256}</dd>
          </div>
        )}
      </dl>

      {receipt.command === undefined ? null : (
        <div className="eng-cmd-row">
          <code className="eng-cmd-code">{receipt.command}</code>
        </div>
      )}

      {receipt.excerpt === undefined ? null : (
        <pre className="rep-code-block">{receipt.excerpt}</pre>
      )}
    </li>
  );
}

export function EvidenceReceiptsExplorer(p: {
  readonly evidence: readonly ReportEvidenceReceiptV1[];
  readonly highlightedReceiptId: string | null;
}): React.JSX.Element {
  const { evidence, highlightedReceiptId } = p;
  return (
    <section
      className="panel rep-section-panel"
      aria-labelledby="rep-evidence-heading"
    >
      <h2 className="rep-panel-title" id="rep-evidence-heading">
        Raw evidence receipts{" "}
        <span className="eng-tab-count">{evidence.length}</span>
      </h2>
      {evidence.length === 0 ? (
        <p className="rep-panel-sub">No evidence receipts attached.</p>
      ) : (
        <ul className="rep-cards-list">
          {evidence.map((receipt) => (
            <ReceiptItem
              key={receipt.id}
              receipt={receipt}
              highlighted={highlightedReceiptId === receipt.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProvenanceAndHistoryPanel({
  detail,
}: {
  readonly detail: ReportRunDetail;
}): React.JSX.Element {
  const { report } = detail;
  const delivery = deliveryStatusMeta(detail.deliveryStatus);

  return (
    <div className="rep-two-col">
      <section
        className="panel rep-section-panel"
        aria-labelledby="rep-provenance-heading"
      >
        <h2 className="rep-panel-title" id="rep-provenance-heading">
          Delivery &amp; workflow provenance
        </h2>
        <dl className="rep-meta-grid">
          <div>
            <dt>Report run ID</dt>
            <dd className="mono">{detail.id}</dd>
          </div>
          <div>
            <dt>Report type</dt>
            <dd className="mono">{report.reportType}</dd>
          </div>
          {report.scheduleId === undefined ? null : (
            <div>
              <dt>Schedule ID</dt>
              <dd className="mono">{report.scheduleId}</dd>
            </div>
          )}
          <div>
            <dt>Workflow ID</dt>
            <dd className="mono">{report.provenance.workflowId}</dd>
          </div>
          <div>
            <dt>Run ID</dt>
            <dd className="mono">{report.provenance.runId}</dd>
          </div>
          <div>
            <dt>Mailbox routing</dt>
            <dd className="mono">
              {detail.mailboxFrom} → {detail.mailboxTo}
            </dd>
          </div>
          <div>
            <dt>Delivery status</dt>
            <dd>
              <span
                className="visual-pill"
                data-sev={pillSeverity(delivery.tone)}
              >
                {delivery.label}
              </span>
              {detail.skipReason === undefined ? null : (
                <span className="rep-cell-sub mono">
                  {" "}
                  ({detail.skipReason})
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Mail message ID</dt>
            <dd className="mono">{detail.messageId ?? "—"}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd className="mono">{formatPacificFull(report.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd className="mono">{formatPacificFull(report.completedAt)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd className="mono">
              {formatDuration(report.startedAt, report.completedAt)}
            </dd>
          </div>
          <div>
            <dt>Accepted / ingested</dt>
            <dd className="mono">
              {formatPacificFull(detail.acceptedAt ?? detail.receivedAt)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="panel rep-section-panel"
        aria-labelledby="rep-history-heading"
      >
        <h2 className="rep-panel-title" id="rep-history-heading">
          Recent schedule runs{" "}
          <span className="eng-tab-count">{detail.recentRuns.length}</span>
        </h2>
        {detail.recentRuns.length === 0 ? (
          <p className="rep-panel-sub">
            Ad-hoc run with no recurring schedule siblings.
          </p>
        ) : (
          <ol className="rep-sibling-strip">
            {detail.recentRuns.map((sibling) => {
              const current = sibling.id === detail.id;
              const verdictTone =
                sibling.verdict === "attention"
                  ? "warning"
                  : sibling.verdict === "changed"
                    ? "info"
                    : "ok";
              return (
                <li key={sibling.id}>
                  <Link
                    to={sibling.runHref}
                    className="rep-sibling-link"
                    aria-current={current ? "page" : undefined}
                  >
                    <span className="mono">
                      {formatPacificShort(sibling.completedAt)}
                    </span>
                    <span className="eng-pill-row">
                      <span
                        className="visual-pill"
                        data-sev={pillSeverity(verdictTone)}
                      >
                        {verdictLabel(sibling.verdict)}
                      </span>
                      <span className="rep-cell-sub">
                        {deliveryStatusMeta(sibling.deliveryStatus).label}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
