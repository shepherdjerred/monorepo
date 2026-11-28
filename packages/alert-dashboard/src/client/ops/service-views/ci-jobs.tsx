import type { CiDashboardResponse } from "@shepherdjerred/ops-model/ci-dashboard.ts";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useId, useState } from "react";

import { CiJobsTables, queuedPipelineAge } from "./ci-jobs-tables.tsx";
import { ciDashboardQuery } from "#client/ops/ops-api.ts";
import { age, formatInstant } from "#client/time.ts";
import { Input } from "#components/input";

type CiSample = NonNullable<CiDashboardResponse["sample"]>;

const NO_ESTIMATES: CiDashboardResponse["estimates"] = {
  runs: {},
  workflows: {},
};

function SampleTime({
  value,
  unavailable,
}: {
  readonly value: string | undefined;
  readonly unavailable: boolean;
}): React.JSX.Element {
  if (value === undefined) return <span>Unavailable</span>;
  return (
    <span title={formatInstant(value)}>
      {unavailable ? "Last known " : "Updated "}
      <time dateTime={value}>{age(value)}</time>
    </span>
  );
}

function QueueMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number | string | null;
}): React.JSX.Element {
  return (
    <div className="eng-kpi-card">
      <dt className="eng-kpi-label">{label}</dt>
      <dd className="eng-kpi-value">
        {value ?? <span className="ci-queue-unavailable">Unavailable</span>}
      </dd>
    </div>
  );
}

function CiQueue({
  sample,
  unavailable,
}: {
  readonly sample: CiSample;
  readonly unavailable: CiDashboardResponse["unavailableSources"];
}): React.JSX.Element {
  const { queue, admission } = sample;
  const oldestAge = queue?.oldestQueuedPipelineCreatedAt;
  return (
    <div className="ci-queue-grid">
      <section className="ci-queue-source" aria-label="Woodpecker queue">
        <header className="ci-queue-source-heading">
          <h3>
            Woodpecker <span>Instance-wide</span>
          </h3>
          <SampleTime
            value={queue?.sampledAt}
            unavailable={unavailable.includes("queue")}
          />
        </header>
        <dl className="ci-queue-metrics">
          <QueueMetric
            label="Ready for a runner"
            value={queue?.ready ?? null}
          />
          <QueueMetric
            label="Waiting on dependencies"
            value={queue?.waitingOnDependencies ?? null}
          />
          <QueueMetric
            label="Running workflows"
            value={queue?.running ?? null}
          />
          <QueueMetric
            label="Oldest queued pipeline age"
            value={
              queue === null
                ? null
                : oldestAge == null
                  ? "—"
                  : queuedPipelineAge(oldestAge, queue.sampledAt)
            }
          />
        </dl>
      </section>
      <section className="ci-queue-source" aria-label="Kueue admission">
        <header className="ci-queue-source-heading">
          <h3>Kueue admission</h3>
          <SampleTime
            value={admission?.sampledAt}
            unavailable={unavailable.includes("admission")}
          />
        </header>
        <dl className="ci-queue-metrics">
          <QueueMetric
            label="Compute pending"
            value={admission?.compute ?? null}
          />
          <QueueMetric label="Gates pending" value={admission?.gates ?? null} />
        </dl>
      </section>
    </div>
  );
}

function CiNotices({
  sample,
  stale,
  failed,
  unavailable,
}: {
  readonly sample: CiSample;
  readonly stale: boolean;
  readonly failed: boolean;
  readonly unavailable: CiDashboardResponse["unavailableSources"];
}): React.JSX.Element | null {
  const notices: string[] = [];
  if (failed)
    notices.push("The last refresh failed. Showing the last known jobs.");
  if (stale) notices.push("CI data is stale. Showing the last known jobs.");
  if (sample.queue?.paused === true)
    notices.push("The Woodpecker queue is paused.");
  if (unavailable.includes("jobs") || sample.jobs === null) {
    notices.push("Monorepo workflow data is unavailable.");
  } else if (sample.jobs.partial) {
    notices.push("Some monorepo workflows could not be loaded.");
  }
  if (notices.length === 0) return null;
  return (
    <div className="eng-callout eng-callout-warning" role="status">
      <div className="eng-callout-body">
        {notices.map((notice) => (
          <p className="eng-callout-title" key={notice}>
            {notice}
          </p>
        ))}
      </div>
    </div>
  );
}

export function CiJobs(): React.JSX.Element | null {
  const query = useQuery(ciDashboardQuery());
  const [filter, setFilter] = useState("");
  const headingId = useId();
  const response = query.data;
  if (response?.enabled === false) return null;

  const sample = response?.sample;
  return (
    <section className="ci-jobs" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-section-title">
        CI jobs and queue
      </h2>
      {response === undefined || sample == null ? (
        <p role="status" className="eng-pkg-sub">
          {query.isPending ? "Loading CI jobs…" : "CI job data is unavailable."}
        </p>
      ) : (
        <>
          <CiNotices
            sample={sample}
            stale={response.stale}
            failed={query.isError}
            unavailable={response.unavailableSources}
          />
          <CiQueue sample={sample} unavailable={response.unavailableSources} />
          {sample.jobs === null ? null : (
            <>
              <div className="ci-jobs-toolbar">
                <label className="visual-search">
                  <span className="sr-only">
                    Filter monorepo runs by PR, branch, or status
                  </span>
                  <SearchIcon aria-hidden="true" />
                  <Input
                    type="search"
                    value={filter}
                    placeholder="Filter by PR, branch, or status"
                    onChange={(event) => {
                      setFilter(event.currentTarget.value);
                    }}
                  />
                </label>
                <SampleTime
                  value={sample.jobs.sampledAt}
                  unavailable={
                    response.stale ||
                    query.isError ||
                    response.unavailableSources.includes("jobs")
                  }
                />
              </div>
              <CiJobsTables
                jobs={sample.jobs}
                estimates={
                  response.stale || query.isError
                    ? NO_ESTIMATES
                    : response.estimates
                }
                filter={filter}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
