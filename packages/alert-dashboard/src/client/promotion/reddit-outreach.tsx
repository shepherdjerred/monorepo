import {
  RedditOutreachReasonSchema,
  type RedditOutreachFailureCategory,
  type RedditOutreachOverview,
  type RedditOutreachReason,
  type RedditOutreachRun,
  type RedditOutreachStopReason,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { LinkOut, time } from "./ui.tsx";

const scheduleLabels = {
  active: "Active",
  paused: "Paused",
  missing: "Missing",
  unavailable: "Unavailable",
} as const;
const publishingLabels = {
  enabled: "Enabled",
  disabled: "Disabled",
  unavailable: "Unavailable",
} as const;
const holdLabels = {
  "logged-out": "Sign-in required",
  challenge: "Reddit challenge",
} as const;
const runLabels = {
  recorded: "Recorded",
  running: "Running",
  failed: "Failed",
  missing: "Audit missing",
  unknown: "Unknown",
} satisfies Record<RedditOutreachRun["status"], string>;
const stopLabels = {
  exhausted: "Listings exhausted",
  "scan-limit": "Listing limit reached",
  "listing-page-limit": "Listing page limit reached",
  "unsettled-page": "Listing page incomplete",
  deadline: "Run deadline reached",
  disabled: "Outreach disabled",
  "browser-budget": "Browser budget reached",
  "thread-budget": "Thread read limit reached",
  "reply-limit": "Run reply limit reached",
  "daily-limit": "Daily reply limit reached",
  "publish-deferred": "Publishing deferred",
  "rate-limit": "Reddit rate limit",
  "decisions-rate-limit": "Decisions API rate limit",
  challenge: "Reddit challenge",
  identity: "Reddit account mismatch",
  "logged-out": "Sign-in required",
  page: "Reddit page unavailable",
  cursor: "Listing cursor unavailable",
  "account-busy": "Reddit account busy",
  blocked: "Run blocked",
  other: "Other stop reason",
} satisfies Record<RedditOutreachStopReason, string>;
const reasonLabels = {
  "listing-ineligible": "Listing ineligible",
  "already-handled": "Already handled",
  "rules-exclude-replies": "Community rules exclude replies",
  "thread-ineligible": "Thread ineligible",
  "intent-unconfirmed": "Server search intent unconfirmed",
  "permission-unconfirmed": "Community permission unconfirmed",
  "requirements-unconfirmed": "Server requirements unmet or unclear",
  "score-too-low": "Fit score missed threshold",
  "decision-declined": "Other qualification rejection",
  "draft-rejected": "Draft rejected",
  "publish-blocked": "Publish blocked",
  "publish-duplicate": "Duplicate at publishing",
  "publish-deferred": "Publish deferred",
  "publish-verified": "Verified during the sweep",
} satisfies Record<RedditOutreachReason, string>;
const failureLabels = {
  browser: "Reddit browser",
  decisions: "Decisions API",
  storage: "Outreach storage",
  workflow: "Temporal workflow",
  other: "Other failure",
} satisfies Record<RedditOutreachFailureCategory, string>;
const number = new Intl.NumberFormat("en-US");

function count(value: number | null) {
  return value === null ? "Unavailable" : number.format(value);
}

function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${String(seconds)} s`
    : `${String(Math.floor(seconds / 60))} min ${String(seconds % 60)} s`;
}

function RunTime({ at }: { at: string | null }) {
  return at === null ? "Not recorded" : <time dateTime={at}>{time(at)}</time>;
}

function OutreachRunDetails({ run }: { run: RedditOutreachRun }) {
  const breakdown = RedditOutreachReasonSchema.options.flatMap((reason) => {
    const total = run.metrics?.reasons[reason];
    return total === undefined ? [] : [{ reason, total }];
  });
  return (
    <details className="p-row-detail p-outreach-detail">
      <summary>Run details</summary>
      {run.failureCategory !== null && (
        <p>Failure category · {failureLabels[run.failureCategory]}</p>
      )}
      {run.metrics === null ? (
        <p className="p-muted">Breakdown unavailable for this run.</p>
      ) : breakdown.length > 0 ? (
        <>
          <p className="p-muted">A thread can have several reasons.</p>
          <dl className="p-outreach-breakdown">
            {breakdown.map(({ reason, total }) => (
              <div key={reason}>
                <dt>{reasonLabels[reason]}</dt>
                <dd>{count(total)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="p-muted">No reasons recorded.</p>
      )}
      {run.cached !== null && run.cached > 0 && (
        <p>{count(run.cached)} cached assessments</p>
      )}
      {run.verifiedReceipts.length > 0 && (
        <ul className="p-outreach-receipts">
          {run.verifiedReceipts.map((url, index) => (
            <li key={url}>
              <LinkOut
                url={url}
                label={`Verified Reddit reply ${String(index + 1)}`}
              />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function OutreachRunRow({ run }: { run: RedditOutreachRun }) {
  const hasAudit = run.status === "recorded";
  return (
    <tr role="row">
      <th scope="row" role="rowheader">
        <RunTime at={run.at} />
        <span className="p-muted p-outreach-run-status">
          {runLabels[run.status]}
          {run.elapsedMs !== null && ` · ${duration(run.elapsedMs)}`}
        </span>
      </th>
      <td role="cell" className="p-outreach-stop">
        {run.stopReason === null ? (
          <span className="p-muted">No stop reason recorded</span>
        ) : (
          stopLabels[run.stopReason]
        )}
        {run.deferUntil != null && (
          <span className="p-muted p-outreach-run-status">
            Deferred until <RunTime at={run.deferUntil} />
          </span>
        )}
      </td>
      <td role="cell">
        {run.inspected === null &&
        run.assessed === null &&
        run.metrics === null ? (
          <span className="p-muted">Run counts unavailable</span>
        ) : (
          <dl className="p-outreach-run-counts">
            <div>
              <dt>Listings</dt>
              <dd>{count(run.inspected)}</dd>
            </div>
            <div>
              <dt>Assessed</dt>
              <dd>{count(run.assessed)}</dd>
            </div>
            <div>
              <dt>Drafts</dt>
              <dd>{count(run.metrics?.draftsPrepared ?? null)}</dd>
            </div>
          </dl>
        )}
      </td>
      <td role="cell">
        {(hasAudit ||
          run.verifiedReceipts.length > 0 ||
          run.unresolvedReplies > 0) && (
          <p className="p-outreach-outcomes">
            <strong>{count(run.verifiedReceipts.length)}</strong> verified
            {" · "}
            <strong>{count(run.unresolvedReplies)}</strong> unresolved
          </p>
        )}
        <OutreachRunDetails run={run} />
      </td>
    </tr>
  );
}

function OutreachRuns({ runs }: { runs: RedditOutreachRun[] }) {
  return (
    <>
      <h3 id="reddit-outreach-runs">Recent production sweeps</h3>
      {runs.length === 0 ? (
        <p className="p-muted">
          No production sweeps recorded today or yesterday.
        </p>
      ) : (
        <div
          className="p-outreach-table-wrap"
          role="region"
          aria-labelledby="reddit-outreach-runs"
          tabIndex={0}
        >
          <table
            className="p-outreach-table"
            role="table"
            aria-labelledby="reddit-outreach-runs"
          >
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Run
                </th>
                <th scope="col" role="columnheader">
                  Stop reason
                </th>
                <th scope="col" role="columnheader">
                  Activity
                </th>
                <th scope="col" role="columnheader">
                  Replies
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {runs.map((run) => (
                <OutreachRunRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function RedditOutreachPanel({
  data,
}: {
  data: RedditOutreachOverview | undefined;
}) {
  return (
    <section className="p-outreach" aria-labelledby="reddit-outreach">
      <h2 id="reddit-outreach">Reddit outreach</h2>
      {data?.status === "available" ? (
        <>
          <dl className="p-outreach-status">
            <div>
              <dt>Schedule</dt>
              <dd>{scheduleLabels[data.schedule.state]}</dd>
            </div>
            <div>
              <dt>Publishing</dt>
              <dd>{publishingLabels[data.publishing]}</dd>
            </div>
            <div>
              <dt>Last run</dt>
              <dd>
                <RunTime at={data.schedule.lastRunAt} />
              </dd>
            </div>
            <div>
              <dt>Next run</dt>
              <dd>
                {data.schedule.state === "active" ? (
                  <RunTime at={data.schedule.nextRunAt} />
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>
                {data.account.hold === null
                  ? "No hold"
                  : holdLabels[data.account.hold]}
              </dd>
            </div>
            {data.account.retryAt !== null && (
              <div>
                <dt>Cooldown until</dt>
                <dd>
                  <RunTime at={data.account.retryAt} />
                </dd>
              </div>
            )}
          </dl>
          <h3>
            Today <span className="p-muted">{data.today.day} Pacific</span>
          </h3>
          <dl className="p-outreach-totals">
            <div>
              <dt>Listings inspected</dt>
              <dd>{count(data.today.inspected)}</dd>
            </div>
            <div>
              <dt>Threads assessed</dt>
              <dd>{count(data.today.assessed)}</dd>
            </div>
            <div>
              <dt>Drafts prepared</dt>
              <dd>{count(data.today.draftsPrepared)}</dd>
            </div>
            <div>
              <dt>Verified replies</dt>
              <dd>{count(data.today.verifiedReplies)}</dd>
            </div>
            <div>
              <dt>Unresolved replies</dt>
              <dd>{count(data.today.unresolvedReplies)}</dd>
            </div>
            <div>
              <dt>Reply slots left</dt>
              <dd>{count(data.today.remainingSlots)}</dd>
            </div>
          </dl>
          <OutreachRuns runs={data.runs} />
        </>
      ) : (
        <p className="p-muted">Outreach status unavailable.</p>
      )}
    </section>
  );
}
