import type {
  PromotionRunRow,
  PromotionRunSummary,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { LinkOut, time } from "./ui.tsx";

function outcome(row: PromotionRunRow) {
  switch (row.outcome) {
    case "done":
      return "Done";
    case "disabled":
      return "Disabled";
    case "not_due":
      return "Not due";
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    case "error":
      return row.health === "disabled"
        ? "Failed; paused"
        : /confirm/i.test(row.reason)
          ? "Unconfirmed"
          : "Failed";
    case "not_run":
      return "Not run";
  }
}

function SourceList({
  rows,
  onHistory,
}: {
  rows: PromotionRunRow[];
  onHistory: (id: string) => void;
}) {
  return (
    <div className="p-source-list">
      {rows.map((row) => (
        <article className="p-source-item" key={row.targetId}>
          <div className="p-source-name">
            <strong>{row.name}</strong>
            <small>{row.platform}</small>
          </div>
          <span className={`p-outcome p-outcome-${row.health}`}>
            {outcome(row)}
          </span>
          <div className="p-source-reason">
            <p>{row.reason}</p>
            <details className="p-row-detail">
              <summary>Details and receipt</summary>
              <p>{row.detail}</p>
              {row.intervention !== null && (
                <p>
                  {row.intervention === "corrected"
                    ? "The post was corrected and its final text was verified."
                    : row.intervention === "cleanup"
                      ? "Reply cleanup succeeded on a later attempt."
                      : "An earlier attempt failed; the later attempt succeeded and was verified."}
                </p>
              )}
              {row.initialDetail !== null &&
                row.initialDetail !== row.detail && (
                  <p>
                    <strong>First attempt:</strong> {row.initialDetail}
                  </p>
                )}
              <p>
                {row.knownGood
                  ? "This source has a confirmed automated action."
                  : "No confirmed automated publishing action is recorded yet."}
              </p>
              {row.nextAllowedAt !== null && (
                <p>Recorded next allowed time: {time(row.nextAllowedAt)}</p>
              )}
              <div className="p-flex">
                <LinkOut url={row.receiptUrl} label="Receipt" />
                <LinkOut url={row.url} label="Source" />
                {row.evidenceId !== null && (
                  <a
                    href={`/api/v1/promotion/evidence/${row.evidenceId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Captured evidence ↗
                  </a>
                )}
                <a
                  href="#promotion-history"
                  onClick={() => {
                    onHistory(row.targetId);
                  }}
                >
                  View history
                </a>
              </div>
            </details>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SourceGroups({
  summary,
  onHistory,
}: {
  summary: PromotionRunSummary;
  onHistory: (id: string) => void;
}) {
  const issues = summary.rows.filter((row) => row.health === "error");
  const done = summary.rows.filter(
    (row) => row.health === "working" && row.outcome === "done",
  );
  const waiting = summary.rows.filter(
    (row) => row.health === "working" && row.outcome !== "done",
  );
  const disabled = summary.rows.filter((row) => row.health === "disabled");
  const checking = summary.rows.filter((row) => row.health === "checking");
  return (
    <>
      <section id="sources-error" className="p-source-group p-group-error">
        <h2>
          Needs attention <span>{issues.length}</span>
        </h2>
        {issues.length === 0 ? (
          <p className="p-muted">No unresolved errors for this run.</p>
        ) : (
          <SourceList rows={issues} onHistory={onHistory} />
        )}
      </section>
      {checking.length > 0 && (
        <section className="p-source-group">
          <h2>
            In progress / not yet verified <span>{checking.length}</span>
          </h2>
          <SourceList rows={checking} onHistory={onHistory} />
        </section>
      )}
      <section id="sources-working" className="p-source-group">
        <h2>
          Working as expected <span>{done.length + waiting.length}</span>
        </h2>
        {done.length > 0 && <SourceList rows={done} onHistory={onHistory} />}
        {waiting.length > 0 && (
          <details className="p-fold">
            <summary>
              {waiting.length} not run — cooldown or not selected
            </summary>
            <SourceList rows={waiting} onHistory={onHistory} />
          </details>
        )}
        {done.length + waiting.length === 0 && (
          <p className="p-muted">
            No confirmed automated results recorded for this run.
          </p>
        )}
      </section>
      <details className="p-source-group p-disabled-group">
        <summary>
          <strong>
            Disabled <span>{disabled.length}</span>
          </strong>
          <span className="p-muted">
            Missing implementation, credentials, access or paused
          </span>
        </summary>
        <div id="sources-disabled">
          <SourceList rows={disabled} onHistory={onHistory} />
        </div>
      </details>
    </>
  );
}
