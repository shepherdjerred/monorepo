import type {
  PromotionRunRow,
  PromotionRunSummary,
  PromotionSourceActivity,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { StatusGlyph, type Severity } from "@shepherdjerred/console-ui";
import { LinkOut, time } from "./ui.tsx";
import { ActivityStrip } from "./activity-strip.tsx";

type Activity = ReadonlyMap<string, PromotionSourceActivity>;

function SourceTime({
  value,
  empty,
  detail,
}: {
  value: string | null | undefined;
  empty: string;
  detail?: string | undefined;
}) {
  return value === undefined ? (
    <span className="p-muted">Unavailable</span>
  ) : value === null ? (
    <span className="p-muted">{empty}</span>
  ) : (
    <time className="p-source-time" dateTime={value} title={detail}>
      {time(value)}
    </time>
  );
}

function outcome(row: PromotionRunRow): {
  label: string;
  severity: Severity;
} {
  switch (row.outcome) {
    case "done":
      return { label: "Done", severity: "ok" };
    case "disabled":
      return { label: "Disabled", severity: "unknown" };
    case "not_due":
      return { label: "Not due", severity: "ok" };
    case "running":
      return { label: "Running", severity: "info" };
    case "queued":
      return { label: "Queued", severity: "info" };
    case "error":
      return row.health === "disabled"
        ? { label: "Failed; paused", severity: "error" }
        : /confirm/i.test(row.reason)
          ? { label: "Unconfirmed", severity: "warning" }
          : { label: "Failed", severity: "error" };
    case "not_run":
      return { label: "Not run", severity: "unknown" };
  }
}

function Outcome({ row }: { row: PromotionRunRow }) {
  const { label, severity } = outcome(row);
  return <StatusGlyph severity={severity} label={label} />;
}

function GroupHead({ title, count }: { title: string; count: number }) {
  return (
    <header className="ui-section-head">
      <h2 className="ui-section-title">{title}</h2>
      <span className="ui-count">{count}</span>
    </header>
  );
}

function SourceList({
  rows,
  label,
  activity,
  onHistory,
}: {
  rows: PromotionRunRow[];
  label: string;
  activity: Activity;
  onHistory: (id: string) => void;
}) {
  return (
    <div
      className="ui-table-scroll p-table-wrap p-source-list"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="ui-table p-source-table">
        <caption className="sr-only">{label}. All times are Pacific.</caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Outcome</th>
            <th scope="col">Last 30 days</th>
            <th scope="col">Last run</th>
            <th scope="col">Last success</th>
            <th scope="col">Next planned</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="p-source-item" key={row.targetId}>
              <th className="p-source-name" scope="row">
                <strong>{row.name}</strong>
                <small>{row.platform}</small>
              </th>
              <td className="p-source-reason" data-label="Outcome">
                <Outcome row={row} />
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
              </td>
              <td className="p-source-activity" data-label="Last 30 days">
                <ActivityStrip
                  activity={activity.get(row.targetId)}
                  name={row.name}
                  onHistory={() => {
                    onHistory(row.targetId);
                  }}
                />
              </td>
              <td className="p-source-timing" data-label="Last run">
                <SourceTime
                  value={row.timing?.lastRunAt}
                  empty="Not recorded"
                />
              </td>
              <td className="p-source-timing" data-label="Last success">
                <SourceTime
                  value={row.timing?.lastSuccessAt}
                  empty="No confirmed success"
                />
              </td>
              <td className="p-source-timing" data-label="Next planned">
                <SourceTime
                  value={row.timing?.nextPlannedAt}
                  empty={row.timing?.nextPlannedReason ?? "Unavailable"}
                  detail={row.timing?.nextPlannedReason}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourceGroups({
  summary,
  activity,
  onHistory,
}: {
  summary: PromotionRunSummary;
  activity: Activity;
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
      <section id="sources-error" className="p-section p-source-group">
        <GroupHead title="Needs attention" count={issues.length} />
        {issues.length === 0 ? (
          <p className="p-muted p-empty">No unresolved errors for this run.</p>
        ) : (
          <SourceList
            rows={issues}
            label="Sources needing attention"
            activity={activity}
            onHistory={onHistory}
          />
        )}
      </section>
      {checking.length > 0 && (
        <section className="p-section p-source-group">
          <GroupHead
            title="In progress or not yet verified"
            count={checking.length}
          />
          <SourceList
            rows={checking}
            label="Sources in progress"
            activity={activity}
            onHistory={onHistory}
          />
        </section>
      )}
      <section id="sources-working" className="p-section p-source-group">
        <GroupHead
          title="Working as expected"
          count={done.length + waiting.length}
        />
        {done.length > 0 && (
          <SourceList
            rows={done}
            label="Working sources"
            activity={activity}
            onHistory={onHistory}
          />
        )}
        {waiting.length > 0 && (
          <details className="p-fold">
            <summary>
              {waiting.length} not run: cooldown or not selected
            </summary>
            <SourceList
              rows={waiting}
              label="Sources not run"
              activity={activity}
              onHistory={onHistory}
            />
          </details>
        )}
        {done.length + waiting.length === 0 && (
          <p className="p-muted p-empty">
            No confirmed automated results recorded for this run.
          </p>
        )}
      </section>
      <details className="p-section p-source-group p-disabled-group">
        <summary className="ui-section-head">
          <span className="ui-section-title">Disabled</span>
          <span className="ui-count">{disabled.length}</span>
          <span className="p-muted">
            Missing implementation, credentials, access or paused
          </span>
        </summary>
        <div id="sources-disabled">
          <SourceList
            rows={disabled}
            label="Disabled sources"
            activity={activity}
            onHistory={onHistory}
          />
        </div>
      </details>
    </>
  );
}
