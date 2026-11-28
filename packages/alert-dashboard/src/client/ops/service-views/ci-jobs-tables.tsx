import { Temporal } from "@js-temporal/polyfill";
import {
  ciRunKey,
  ciWorkflowKey,
  type CiDashboardResponse,
  type CiEstimate,
  type CiRun,
  type CiWorkflow,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import { ExternalLinkIcon } from "lucide-react";

import { formatInstant } from "#client/time.ts";
import { DataTable, type DataTableColumn } from "#client/visuals/index.ts";
import { pillSeverity, type PillTone } from "#client/visuals/pill.ts";

type ActiveRow = {
  readonly key: string;
  readonly run: CiRun;
  readonly workflow: CiWorkflow | null;
  readonly elapsed: number | null;
  readonly estimate: CiEstimate | undefined;
};

function durationSeconds(start: string, end: string): number {
  return Math.max(
    0,
    Math.floor(
      Temporal.Instant.from(end)
        .since(Temporal.Instant.from(start))
        .total({ unit: "seconds" }),
    ),
  );
}

export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${String(minutes)}m`
    : `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

export function queuedPipelineAge(
  createdAt: string,
  sampledAt: string,
): string {
  return durationLabel(durationSeconds(createdAt, sampledAt));
}

const STATE_LABELS: Readonly<Record<string, [label: string, tone: PillTone]>> =
  {
    ready: ["Ready for runner", "info"],
    pending: ["Queued", "info"],
    created: ["Queued", "info"],
    waiting: ["Waiting", "warning"],
    waiting_on_deps: ["Waiting on dependencies", "warning"],
    running: ["Running", "info"],
    started: ["Running", "info"],
    blocked: ["Approval needed", "warning"],
    success: ["Passed", "ok"],
    failure: ["Failed", "error"],
    error: ["Error", "error"],
    killed: ["Canceled", "neutral"],
    canceled: ["Canceled", "neutral"],
    skipped: ["Skipped", "neutral"],
    declined: ["Declined", "neutral"],
  };

function stateLabel(state: string): string {
  return STATE_LABELS[state]?.[0] ?? state.replaceAll("_", " ");
}

function StatePill({ state }: { readonly state: string }): React.JSX.Element {
  return (
    <span
      className="visual-pill"
      data-sev={pillSeverity(STATE_LABELS[state]?.[1] ?? "neutral")}
    >
      {stateLabel(state)}
    </span>
  );
}

function RunIdentity({ run }: { readonly run: CiRun }): React.JSX.Element {
  return (
    <div className="ci-job-cell">
      <span>{run.pr === null ? run.branch : `PR #${String(run.pr)}`}</span>
      <span className="eng-pkg-sub">
        <a
          className="eng-ext-link"
          href={run.url}
          target="_blank"
          rel="noreferrer"
        >
          #{run.pipeline}
          <ExternalLinkIcon aria-hidden="true" />
        </a>
        {" · "}
        <code title={run.commit}>{run.commit.slice(0, 7)}</code>
        {" · "}Attempt {run.attempt + 1}
      </span>
      {run.pr === null ? null : (
        <span className="eng-pkg-sub">{run.branch}</span>
      )}
    </div>
  );
}

function localTime(value: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(value).toZonedDateTimeISO(
    Temporal.Now.timeZoneId(),
  );
}

function timeLabel(value: Temporal.ZonedDateTime, showDate: boolean): string {
  return value.toLocaleString(undefined, {
    ...(showDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

function sortTimestamp(value: string | null | undefined): number | null {
  return value == null ? null : Temporal.Instant.from(value).epochMilliseconds;
}

function EstimateCell({
  estimate,
  finishedAt,
  gate,
}: {
  readonly estimate: CiEstimate | undefined;
  readonly finishedAt: string | null;
  readonly gate: boolean;
}): React.JSX.Element {
  if (finishedAt !== null) {
    return (
      <time dateTime={finishedAt}>
        {timeLabel(localTime(finishedAt), true)}
      </time>
    );
  }
  if (estimate === undefined) {
    return <span className="eng-pkg-sub">ETA unavailable</span>;
  }
  const earliest = localTime(estimate.earliestAt);
  const latest = localTime(estimate.latestAt);
  const spansDays = !earliest.toPlainDate().equals(latest.toPlainDate());
  return (
    <div className="ci-job-cell">
      <span className="eng-pkg-sub">
        {gate
          ? estimate.kind === "rough"
            ? "Rough PR CI finish"
            : "PR CI finish"
          : "Estimated finish"}
      </span>
      <span
        title={`${formatInstant(estimate.earliestAt)} to ${formatInstant(estimate.latestAt)}`}
      >
        <time dateTime={estimate.earliestAt}>
          {timeLabel(earliest, spansDays)}
        </time>
        {" – "}
        <time dateTime={estimate.latestAt}>{timeLabel(latest, spansDays)}</time>
      </span>
    </div>
  );
}

const ACTIVE_COLUMNS: readonly DataTableColumn<ActiveRow>[] = [
  {
    key: "run",
    header: "Run",
    sortValue: ({ run }) => run.pipeline,
    render: ({ run }) => <RunIdentity run={run} />,
  },
  {
    key: "workflow",
    header: "Workflow",
    sortValue: ({ workflow }) => workflow?.name,
    render: ({ workflow }) =>
      workflow === null ? (
        <span className="eng-pkg-sub">Workflow details unavailable</span>
      ) : (
        <a
          className="eng-ext-link"
          href={workflow.url}
          target="_blank"
          rel="noreferrer"
        >
          {workflow.name}
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      ),
  },
  {
    key: "state",
    header: "State",
    sortValue: ({ run, workflow }) => stateLabel(workflow?.state ?? run.state),
    render: ({ run, workflow }) => (
      <div className="ci-job-cell">
        <StatePill state={workflow?.state ?? run.state} />
        {workflow?.blocker == null ? null : (
          <span className="eng-pkg-sub">{workflow.blocker}</span>
        )}
      </div>
    ),
  },
  {
    key: "elapsed",
    header: "Elapsed",
    sortValue: ({ elapsed }) => elapsed,
    render: ({ elapsed }) => (elapsed === null ? "—" : durationLabel(elapsed)),
  },
  {
    key: "estimate",
    header: "Finish / ETA",
    sortValue: ({ estimate, workflow }) =>
      sortTimestamp(workflow?.finishedAt ?? estimate?.earliestAt),
    render: ({ estimate, workflow }) => (
      <EstimateCell
        estimate={estimate}
        finishedAt={workflow?.finishedAt ?? null}
        gate={workflow?.name === "ci-complete"}
      />
    ),
  },
];

const RECENT_COLUMNS: readonly DataTableColumn<CiRun>[] = [
  {
    key: "run",
    header: "Run",
    sortValue: (run) => run.pipeline,
    render: (run) => <RunIdentity run={run} />,
  },
  {
    key: "state",
    header: "Result",
    sortValue: (run) => stateLabel(run.state),
    render: (run) => <StatePill state={run.state} />,
  },
  {
    key: "elapsed",
    header: "Elapsed",
    sortValue: (run) =>
      run.finishedAt === null
        ? null
        : durationSeconds(run.createdAt, run.finishedAt),
    render: (run) =>
      run.finishedAt === null
        ? "—"
        : durationLabel(durationSeconds(run.createdAt, run.finishedAt)),
  },
  {
    key: "finishedAt",
    header: "Finished",
    sortValue: (run) => sortTimestamp(run.finishedAt),
    render: (run) =>
      run.finishedAt === null ? (
        "—"
      ) : (
        <time dateTime={run.finishedAt}>
          {timeLabel(localTime(run.finishedAt), true)}
        </time>
      ),
  },
];

function matchesFilter(run: CiRun, state: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/u);
  const pr = run.pr === null ? "" : `PR #${String(run.pr)} ${String(run.pr)}`;
  const searchable = [pr, run.branch, state, stateLabel(state)]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => searchable.includes(term));
}

function activeRows(
  runs: readonly CiRun[],
  sampledAt: string,
  estimates: CiDashboardResponse["estimates"],
): ActiveRow[] {
  return runs.flatMap<ActiveRow>((run) => {
    const workflows = run.workflows.filter(
      (workflow) =>
        workflow.finishedAt === null || workflow.name === "ci-complete",
    );
    if (workflows.length === 0) {
      return [
        {
          key: ciRunKey(run),
          run,
          workflow: null,
          elapsed: null,
          estimate: undefined,
        },
      ];
    }
    return workflows.map((workflow) => ({
      key: ciWorkflowKey(run, workflow),
      run,
      workflow,
      elapsed:
        workflow.startedAt === null
          ? null
          : durationSeconds(
              workflow.startedAt,
              workflow.finishedAt ?? sampledAt,
            ),
      estimate:
        workflow.name === "ci-complete"
          ? estimates.runs[ciRunKey(run)]
          : estimates.workflows[ciWorkflowKey(run, workflow)],
    }));
  });
}

export function CiJobsTables({
  jobs,
  estimates,
  filter,
}: {
  readonly jobs: NonNullable<
    NonNullable<CiDashboardResponse["sample"]>["jobs"]
  >;
  readonly estimates: CiDashboardResponse["estimates"];
  readonly filter: string;
}): React.JSX.Element {
  const active = activeRows(jobs.active, jobs.sampledAt, estimates);
  return (
    <>
      <DataTable
        caption="Active monorepo workflows"
        rows={active.filter(({ run, workflow }) =>
          matchesFilter(run, workflow?.state ?? run.state, filter),
        )}
        rowKey={(row) => row.key}
        columns={ACTIVE_COLUMNS}
        defaultSort={{ key: "run", direction: "descending" }}
        emptyMessage={
          active.length === 0
            ? "No active workflows reported."
            : "No matching active workflows."
        }
        initialCap={12}
      />
      <DataTable
        caption="Recent completed monorepo runs"
        rows={jobs.recent.filter((run) =>
          matchesFilter(run, run.state, filter),
        )}
        rowKey={ciRunKey}
        columns={RECENT_COLUMNS}
        defaultSort={{ key: "finishedAt", direction: "descending" }}
        emptyMessage={
          jobs.recent.length === 0
            ? "No completed runs reported."
            : "No matching completed runs."
        }
        initialCap={5}
      />
    </>
  );
}
