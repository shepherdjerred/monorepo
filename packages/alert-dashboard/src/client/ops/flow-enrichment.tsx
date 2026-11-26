import { Chip } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import type {
  GitHubFacet,
  GitHubOpenPr,
  GitHubRateLimitBucket,
  MonorepoCodeReview,
  TrackerFacet,
  TrackerNotice,
  TrackerProjectSummary,
} from "@shepherdjerred/ops-model/facets.ts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import { useId } from "react";
import { Link } from "react-router";

import { ListToggle, useCapped } from "./capped-list.tsx";
import { facetsQuery } from "./ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { age } from "#client/time.ts";
import {
  BudgetMeter,
  DataTable,
  StackTree,
  type DataTableColumn,
  type StackCheckState,
  type StackMergeableState,
  type StackPullRequest,
  type StackReviewDecision,
} from "#client/visuals/index.ts";
import "#styles/engineering.css";
import { Identifier } from "#client/visuals/identifier.tsx";

const FLOW_CAP = 8;

export function toStackCheckState(raw: string): StackCheckState {
  switch (raw) {
    case "SUCCESS":
    case "FAILURE":
    case "ERROR":
    case "PENDING":
    case "EXPECTED":
    case "NONE":
    case "passing":
    case "failing":
    case "pending":
    case "none":
      return raw;
    default:
      return "NONE";
  }
}

export function toStackReviewDecision(raw: string | null): StackReviewDecision {
  switch (raw) {
    case "APPROVED":
    case "CHANGES_REQUESTED":
    case "REVIEW_REQUIRED":
    case "approved":
    case "changes_requested":
    case "review_required":
    case null:
      return raw;
    default:
      return null;
  }
}

export function toStackMergeableState(raw: string): StackMergeableState {
  switch (raw) {
    case "MERGEABLE":
    case "CONFLICTING":
    case "UNKNOWN":
    case "mergeable":
    case "conflicting":
    case "unknown":
      return raw;
    default:
      return "UNKNOWN";
  }
}

export function mapGitHubPrToStackPr(pr: GitHubOpenPr): StackPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    branch: pr.branch,
    baseRefName: pr.baseRefName,
    authorLogin: pr.authorLogin,
    draft: pr.draft,
    checks: toStackCheckState(pr.checks),
    reviewDecision: toStackReviewDecision(pr.reviewDecision),
    exactHeadApproved: pr.exactHeadApproved,
    mergeable: toStackMergeableState(pr.mergeable),
    ageHours: pr.ageHours,
  };
}

const NOTICE_COLUMNS: readonly DataTableColumn<TrackerNotice>[] = [
  {
    key: "identifier",
    header: "Thread",
    sortValue: (notice) => notice.identifier,
    render: (notice) => (
      <a
        className="eng-ext-link"
        href={notice.url}
        target="_blank"
        rel="noreferrer"
      >
        {notice.identifier}
        <ExternalLinkIcon aria-hidden="true" />
      </a>
    ),
  },
  {
    key: "title",
    header: "Coordination notice",
    sortValue: (notice) => notice.title,
    render: (notice) => (
      <div className="eng-pkg-cell">
        <span>{notice.title}</span>
        <span className="eng-pkg-sub">
          <span className="visual-pill" data-sev="info">
            {notice.kind}
          </span>
          {notice.owner === null ? null : <span>{`@${notice.owner}`}</span>}
          {notice.scopes.slice(0, 3).map((scope) => (
            <code key={scope} className="visual-branch-chip">
              <Identifier value={scope} />
            </code>
          ))}
        </span>
      </div>
    ),
  },
  {
    key: "updatedAt",
    header: "Updated",
    align: "right",
    sortValue: (notice) => notice.updatedAt,
    render: (notice) => (
      <time dateTime={notice.updatedAt}>{age(notice.updatedAt)}</time>
    ),
  },
];

const PROJECT_COLUMNS: readonly DataTableColumn<TrackerProjectSummary>[] = [
  {
    key: "name",
    header: "Project",
    sortValue: (proj) => proj.name,
    render: (proj) => proj.name,
  },
  {
    key: "team",
    header: "Team",
    sortValue: (proj) => proj.team,
    render: (proj) => <span className="visual-pill">{proj.team}</span>,
  },
  {
    key: "openCount",
    header: "Open",
    align: "right",
    sortValue: (proj) => proj.openCount,
    render: (proj) => String(proj.openCount),
  },
  {
    key: "completed7dCount",
    header: "Done (7d)",
    align: "right",
    sortValue: (proj) => proj.completed7dCount,
    render: (proj) => String(proj.completed7dCount),
  },
];

function RateLimitMeter({
  label,
  bucket,
}: {
  readonly label: string;
  readonly bucket: GitHubRateLimitBucket | null;
}): React.JSX.Element {
  return (
    <BudgetMeter
      label={label}
      value={bucket === null ? null : bucket.used}
      max={bucket === null ? 5000 : Math.max(1, bucket.limit)}
      unit="count"
      detail={
        bucket === null
          ? "Rate limit unavailable"
          : `${String(bucket.remaining)} remaining`
      }
    />
  );
}

function GitHubStacksPanel({
  github,
  codeReview,
}: {
  readonly github: GitHubFacet;
  readonly codeReview?: MonorepoCodeReview | undefined;
}): React.JSX.Element {
  const stackContainerId = useId();
  const nonRenovatePrs = github.openPrs
    .filter((pr) => !pr.isRenovate)
    .map((pr) => mapGitHubPrToStackPr(pr));
  const capped = useCapped(nonRenovatePrs, FLOW_CAP);

  return (
    <section className="eng-flow-panel" aria-labelledby="flow-stacks-heading">
      <header className="ui-section-head">
        <h3 id="flow-stacks-heading" className="ui-section-title">
          git-spice PR stacks
        </h3>
        <span className="ui-count">{nonRenovatePrs.length}</span>
      </header>
      <div id={stackContainerId}>
        <StackTree
          pullRequests={capped.shown}
          label="Non-Renovate pull request stacks"
          emptyMessage="No non-Renovate pull requests open."
        />
      </div>
      <ListToggle list={capped} controls={stackContainerId} />
      {codeReview === undefined ? null : (
        <div className="eng-throughput-strip eng-flow-code-review-strip">
          <Chip
            label="Review pool ready"
            value={`${String(codeReview.readyProvidersCount)}/${String(codeReview.activeProvidersCount)}`}
          />
          <Chip
            label="Re-reviews saved 7d"
            value={codeReview.outcomes7d.priorRound}
          />
          <Link className="eng-ext-link" to="/monorepo#code-review">
            Code review pool
          </Link>
        </div>
      )}
      <div className="eng-rate-limits">
        <RateLimitMeter
          label="GitHub GraphQL quota used"
          bucket={github.rateLimits.graphql}
        />
        <RateLimitMeter
          label="GitHub Core API quota used"
          bucket={github.rateLimits.core}
        />
      </div>
    </section>
  );
}

function TrackerCoordinationPanel({
  tracker,
}: {
  readonly tracker: TrackerFacet;
}): React.JSX.Element {
  const teamEntries = Object.entries(tracker.openByTeam).sort((left, right) =>
    left[0].localeCompare(right[0]),
  );

  return (
    <section className="eng-flow-panel" aria-labelledby="flow-forum-heading">
      <header className="ui-section-head">
        <h3 id="flow-forum-heading" className="ui-section-title">
          Forum coordination and throughput
        </h3>
        <span className="ui-count">{tracker.activeNotices.length}</span>
      </header>
      <div className="eng-throughput-strip">
        <Chip label="Completed 7d" value={tracker.completed7dCount} />
        <Chip label="Triage" value={tracker.triageCount} />
        {teamEntries.map(([team, openCount]) => (
          <Chip key={team} label={`${team} open`} value={openCount} />
        ))}
      </div>
      <DataTable
        caption="Active Tracker Forum coordination notices"
        hideCaption
        rows={tracker.activeNotices}
        rowKey={(notice) => notice.identifier}
        columns={NOTICE_COLUMNS}
        initialCap={FLOW_CAP}
        emptyMessage="No active Forum coordination notices."
      />
      {tracker.projects.length === 0 ? null : (
        <DataTable
          caption="Tracker project throughput"
          hideCaption
          rows={tracker.projects}
          rowKey={(proj) => proj.slug}
          columns={PROJECT_COLUMNS}
          initialCap={FLOW_CAP}
          emptyMessage="No active Tracker projects."
        />
      )}
    </section>
  );
}

export function FlowEnrichment(): React.JSX.Element | null {
  const loaded = Loaded.fromQuery(useQuery(facetsQuery()));
  const response = Loaded.getOrElse(loaded, undefined);
  const github = response?.facets.github;
  const tracker = response?.facets.tracker;

  if (github === undefined && tracker === undefined) {
    return null;
  }

  return (
    <section className="eng-flow-section" aria-label="Stacks and coordination">
      {loaded.status === "degraded" ? (
        <StaleNotice errors={loaded.errors} />
      ) : null}
      <div className="eng-flow-grid">
        {github === undefined ? null : (
          <GitHubStacksPanel
            github={github}
            codeReview={response?.facets.monorepo?.codeReview}
          />
        )}
        {tracker === undefined ? null : (
          <TrackerCoordinationPanel tracker={tracker} />
        )}
      </div>
    </section>
  );
}
