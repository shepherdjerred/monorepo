import { StatusGlyph } from "@shepherdjerred/console-ui";
import {
  formatMailClientLabel,
  type AdminMessageDetail,
  type DeliveryAttempt,
} from "@shepherdjerred/mail/shared/contract.ts";
import { useMemo } from "react";

import {
  attemptOutcomeLabel,
  attemptOutcomeSeverity,
  formatDiagnosticSummary,
  formatDurationMs,
  formatPacificFull,
  messageStatusLabel,
  messageStatusSeverity,
} from "./format.ts";

export function MessageMetaGrid({
  detail,
}: {
  readonly detail: AdminMessageDetail;
}): React.JSX.Element {
  const diagnostic = formatDiagnosticSummary(detail);
  const callerLabel = formatMailClientLabel(detail.clientId);
  const terminalTimestamp = detail.sentAt ?? detail.failedAt;

  return (
    <dl className="mail-meta-grid">
      <div className="mail-meta-item">
        <dt>Status</dt>
        <dd>
          <StatusGlyph
            severity={messageStatusSeverity(detail.status)}
            label={messageStatusLabel(detail.status)}
          />
        </dd>
      </div>
      <div className="mail-meta-item">
        <dt>Caller</dt>
        <dd>
          {callerLabel === detail.clientId ? (
            <span className="ui-mono">{detail.clientId}</span>
          ) : (
            <>
              {callerLabel}{" "}
              <span className="ui-mono ui-muted">({detail.clientId})</span>
            </>
          )}
        </dd>
      </div>
      <div className="mail-meta-item">
        <dt>Protocol</dt>
        <dd className="ui-mono">{detail.protocol.toUpperCase()}</dd>
      </div>
      <div className="mail-meta-item">
        <dt>Envelope From</dt>
        <dd className="ui-mono mail-wrap">{detail.mailFrom}</dd>
      </div>
      <div className="mail-meta-item">
        <dt>Recipients</dt>
        <dd className="ui-mono mail-wrap">{detail.recipients.join(", ")}</dd>
      </div>
      <div className="mail-meta-item">
        <dt>From Header</dt>
        <dd className="ui-mono mail-wrap">
          {detail.fromHeader.length > 0 ? detail.fromHeader : "—"}
        </dd>
      </div>
      <div className="mail-meta-item">
        <dt>RFC Message-ID</dt>
        <dd className="ui-mono mail-wrap">{detail.rfcMessageId}</dd>
      </div>
      <div className="mail-meta-item">
        <dt>Tag</dt>
        <dd className={detail.tag === null ? "ui-muted" : "ui-mono mail-wrap"}>
          {detail.tag ?? "—"}
        </dd>
      </div>
      <div className="mail-meta-item">
        <dt>Idempotency Key</dt>
        <dd
          className={
            detail.idempotencyKey === null ? "ui-muted" : "ui-mono mail-wrap"
          }
        >
          {detail.idempotencyKey ?? "—"}
        </dd>
      </div>
      <div className="mail-meta-item">
        <dt>Created</dt>
        <dd className="ui-mono">
          <time dateTime={detail.createdAt}>
            {formatPacificFull(detail.createdAt)}
          </time>
        </dd>
      </div>
      <div className="mail-meta-item">
        <dt>Sent / Failed</dt>
        <dd className="ui-mono">
          {terminalTimestamp === null ? (
            detail.status === "retrying" ? (
              <span className="ui-muted">
                Next retry {formatPacificFull(detail.nextAttemptAt)}
              </span>
            ) : (
              "—"
            )
          ) : (
            <time dateTime={terminalTimestamp}>
              {formatPacificFull(terminalTimestamp)}
            </time>
          )}
        </dd>
      </div>
      <div
        className="mail-meta-item mail-meta-wide"
        data-sev={diagnostic.isError ? "error" : undefined}
      >
        <dt>{diagnostic.label}</dt>
        <dd
          className={
            diagnostic.isError
              ? "ui-mono mail-wrap mail-diag-error"
              : "ui-mono mail-wrap"
          }
        >
          {diagnostic.value}
        </dd>
      </div>
    </dl>
  );
}

export function AttemptsTable({
  attempts,
}: {
  readonly attempts: readonly DeliveryAttempt[];
}): React.JSX.Element {
  return (
    <div
      className="ui-table-scroll mail-table-wrap"
      role="region"
      aria-label="Delivery attempts"
      tabIndex={0}
    >
      <table className="ui-table mail-detail-table">
        <caption className="mail-table-caption">Delivery attempts</caption>
        <thead>
          <tr>
            <th scope="col">Attempt</th>
            <th scope="col">Outcome</th>
            <th scope="col">SMTP Code</th>
            <th scope="col" className="ui-num">
              Duration
            </th>
            <th scope="col">Finished</th>
            <th scope="col">Response / Error</th>
          </tr>
        </thead>
        <tbody>
          {attempts.length === 0 ? (
            <tr>
              <td colSpan={6} className="mail-empty-cell ui-muted">
                No SMTP delivery attempts recorded yet.
              </td>
            </tr>
          ) : (
            attempts.map((attempt) => (
              <tr key={attempt.id}>
                <th scope="row" className="ui-mono">
                  #{String(attempt.attemptNumber)}
                </th>
                <td data-label="Outcome">
                  <StatusGlyph
                    severity={attemptOutcomeSeverity(attempt.outcome)}
                    label={attemptOutcomeLabel(attempt.outcome)}
                  />
                </td>
                <td data-label="SMTP Code" className="ui-mono">
                  {attempt.smtpCode === null ? "—" : String(attempt.smtpCode)}
                </td>
                <td data-label="Duration" className="ui-num ui-mono">
                  {formatDurationMs(attempt.durationMs)}
                </td>
                <td data-label="Finished" className="ui-mono ui-muted">
                  <time dateTime={attempt.finishedAt}>
                    {formatPacificFull(attempt.finishedAt)}
                  </time>
                </td>
                <td
                  data-label="Response / Error"
                  className="ui-mono mail-wrap mail-response-cell"
                >
                  {attempt.error ?? attempt.smtpResponse ?? "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function HeadersTable({
  headers,
}: {
  readonly headers: Readonly<Record<string, string>>;
}): React.JSX.Element {
  const entries = useMemo(
    () =>
      Object.entries(headers).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [headers],
  );

  return (
    <div
      className="ui-table-scroll mail-table-wrap"
      role="region"
      aria-label="Message headers"
      tabIndex={0}
    >
      <table className="ui-table mail-detail-table">
        <caption className="mail-table-caption">Message headers</caption>
        <thead>
          <tr>
            <th scope="col">Header</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={2} className="mail-empty-cell ui-muted">
                No custom headers submitted with this message.
              </td>
            </tr>
          ) : (
            entries.map(([name, value]) => (
              <tr key={name}>
                <th scope="row" className="ui-mono">
                  {name}
                </th>
                <td
                  data-label="Value"
                  className="ui-mono mail-wrap mail-response-cell"
                >
                  {value}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
