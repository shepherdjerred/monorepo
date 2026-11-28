import {
  compareRankedRenovateUpdates,
  type RankedRenovateUpdate,
  type RenovateDisposition,
  type RenovateRankedQueue,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { useId, useState } from "react";

import { formatInstant } from "#client/time.ts";
import { DataTable, type DataTableColumn } from "#client/visuals/index.ts";

import { ExtLink } from "./renovate-helpers.tsx";

const URGENCY = { high: "High", medium: "Medium", low: "Low" };
const EFFORT = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
  unknown: "Unknown",
};
const BAKE = {
  ready: "Complete",
  waiting: "Baking",
  unknown: "Age unverified",
};
const STATUS = {
  ready: "Ready",
  baking: "Baking",
  unverified: "Age unverified",
  review: "Needs review",
  optional: "Optional",
  queued: "Queued",
  blocked: "Blocked",
  published: "PR open",
  merged: "Merged",
  closed: "PR closed",
  landed: "On main",
};

type RankedRow = {
  readonly candidate: RankedRenovateUpdate;
  readonly disposition: RenovateDisposition | undefined;
  readonly status: keyof typeof STATUS;
};

function executionStatus(
  candidate: RankedRenovateUpdate,
  disposition: RenovateDisposition | undefined,
): RankedRow["status"] {
  if (disposition !== undefined) return disposition.status;
  if (candidate.blockers.length > 0) return "blocked";
  if (!candidate.needed) return "optional";
  if (candidate.bake.state === "waiting") return "baking";
  if (candidate.bake.state === "unknown") return "unverified";
  return candidate.effort === "xs" ||
    candidate.effort === "s" ||
    candidate.effort === "m"
    ? "ready"
    : "review";
}

const COLUMNS: readonly DataTableColumn<RankedRow>[] = [
  {
    key: "update",
    header: "Update",
    render: ({ candidate }) => (
      <div className="eng-pkg-cell">
        <strong className="eng-pkg-name">{candidate.name}</strong>
        <span className="eng-pkg-sub">{candidate.ecosystem}</span>
      </div>
    ),
  },
  {
    key: "urgency",
    header: "Urgency",
    render: ({ candidate }) => URGENCY[candidate.urgency],
  },
  {
    key: "effort",
    header: "Effort",
    render: ({ candidate }) => EFFORT[candidate.effort],
  },
  {
    key: "bake",
    header: "Bake period",
    render: ({ candidate }) => (
      <div className="eng-pkg-cell">
        <span>{BAKE[candidate.bake.state]}</span>
        {candidate.bake.eligibleAt === null ? null : (
          <time className="eng-pkg-sub" dateTime={candidate.bake.eligibleAt}>
            {formatInstant(candidate.bake.eligibleAt)}
          </time>
        )}
      </div>
    ),
  },
  {
    key: "execution",
    header: "Execution",
    render: ({ status, disposition }) => (
      <div className="eng-pill-row">
        <span className="visual-pill">{STATUS[status]}</span>
        {disposition?.prUrl === undefined ? null : (
          <ExtLink href={disposition.prUrl}>
            {`PR #${new URL(disposition.prUrl).pathname.split("/").at(-1) ?? ""}`}
          </ExtLink>
        )}
      </div>
    ),
  },
];

function RankingDetails({
  candidate,
  disposition,
}: RankedRow): React.JSX.Element {
  return (
    <div className="eng-delta-drawer eng-renovate-assessment">
      <div className="eng-delta-box">
        <strong>Assessment</strong>
        <p>{candidate.rationale}</p>
        <p>{candidate.bake.reason}</p>
        {disposition === undefined ? null : (
          <p>
            {disposition.reason}
            {" · "}
            <time dateTime={disposition.updatedAt}>
              {formatInstant(disposition.updatedAt)}
            </time>
          </p>
        )}
        {candidate.blockers.length === 0 ? null : (
          <ul>
            {candidate.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        {candidate.evidenceUrls.length === 0 ? null : (
          <ul className="eng-renovate-evidence">
            {[...new Set(candidate.evidenceUrls)].map((href) => {
              const url = new URL(href);
              return (
                <li key={href}>
                  <ExtLink href={href}>
                    {url.hostname}
                    {url.pathname}
                  </ExtLink>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="eng-delta-box">
        <strong>Target changes</strong>
        <ul>
          {candidate.targets.map((target) => (
            <li
              key={`${target.filePath}:${target.packageName}:${target.targetValue}:${target.digest ?? ""}`}
            >
              <code>{target.filePath}</code>
              {" · "}
              {target.packageName}{" "}
              <code>{target.currentValue ?? "Unpinned"}</code>
              {" → "}
              <code>{target.targetValue}</code>
              {target.digest === null ? null : (
                <>
                  {" "}
                  <code>{target.digest}</code>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RankingFilter(props: {
  readonly label: string;
  readonly options: Readonly<Record<string, string>>;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        className="ui-select"
        value={props.value}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
      >
        <option value="all">All</option>
        {Object.entries(props.options).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RenovateRanking({
  ranking,
}: {
  readonly ranking: RenovateRankedQueue | undefined;
}): React.JSX.Element {
  const [urgency, setUrgency] = useState("all");
  const [effort, setEffort] = useState("all");
  const [status, setStatus] = useState("all");
  const heading = <h2 className="block-heading">Ranked dependency queue</h2>;
  if (ranking === undefined) {
    return (
      <section className="eng-renovate-ranking">
        {heading}
        <p className="visual-empty">
          No dependency assessment has been recorded yet.
        </p>
      </section>
    );
  }

  const { snapshot, dispositions } = ranking;
  const rows = snapshot.candidates
    .map((candidate): RankedRow => {
      const disposition = dispositions[candidate.id];
      return {
        candidate: {
          ...candidate,
          effort: disposition?.revisedEffort ?? candidate.effort,
        },
        disposition,
        status: executionStatus(candidate, disposition),
      };
    })
    .sort((left, right) =>
      compareRankedRenovateUpdates(left.candidate, right.candidate),
    )
    .filter(
      (row) =>
        (urgency === "all" || row.candidate.urgency === urgency) &&
        (effort === "all" || row.candidate.effort === effort) &&
        (status === "all" || row.status === status),
    );
  return (
    <section className="eng-renovate-ranking">
      {heading}
      <p className="eng-renovate-meta">
        <span>
          Assessed{" "}
          <time dateTime={snapshot.scannedAt}>
            {formatInstant(snapshot.scannedAt)}
          </time>
        </span>
        <span>
          {snapshot.coverage === "complete"
            ? "Complete lookup"
            : "Partial lookup"}
        </span>
        <span>
          main <code>{snapshot.baseSha.slice(0, 12)}</code>
        </span>
      </p>
      {snapshot.warnings.length === 0 ? null : (
        <ul className="eng-renovate-warnings">
          {[...new Set(snapshot.warnings)].map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <div className="eng-renovate-filters">
        <RankingFilter
          label="Urgency"
          options={URGENCY}
          value={urgency}
          onChange={setUrgency}
        />
        <RankingFilter
          label="Effort"
          options={EFFORT}
          value={effort}
          onChange={setEffort}
        />
        <RankingFilter
          label="Status"
          options={STATUS}
          value={status}
          onChange={setStatus}
        />
      </div>
      <DataTable
        caption="Ranked dependency updates"
        hideCaption
        rows={rows}
        rowKey={(row) => row.candidate.id}
        rowLabel={(row) => row.candidate.name}
        columns={COLUMNS}
        searchPlaceholder="Search package or file…"
        searchText={({ candidate }) =>
          `${candidate.name} ${candidate.ecosystem} ${candidate.targets.map((target) => `${target.packageName} ${target.filePath}`).join(" ")}`
        }
        initialCap={20}
        renderExpanded={(row) => <RankingDetails {...row} />}
        emptyMessage={
          snapshot.candidates.length === 0
            ? "No dependency updates in this assessment."
            : "No updates match these filters."
        }
      />
    </section>
  );
}
