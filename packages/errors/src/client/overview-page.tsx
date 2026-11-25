import {
  Button,
  Chip,
  FigureStrip,
  HeaderBar,
  StatusGlyph,
  type Figure,
} from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { Link } from "react-router";
import type {
  IssueListItem,
  OverviewResponse,
  ProjectSummary,
} from "#shared/contract.ts";
import { fetchOverview, queryKeys } from "./api.ts";
import {
  formatAge,
  formatCount,
  issueGlyphLabel,
  issueSeverity,
  trackerIssueUrl,
} from "./format.ts";

function AttentionIssuesSection({
  issues,
  nowMs,
}: {
  readonly issues: readonly IssueListItem[];
  readonly nowMs?: number | undefined;
}): React.JSX.Element {
  return (
    <section className="er-section" aria-labelledby="er-attention-heading">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="er-attention-heading">
          Needs attention
        </h2>
        <span className="ui-count">{formatCount(issues.length)}</span>
      </div>
      {issues.length === 0 ? (
        <p className="er-state">
          All clear — no unresolved or regressed issues need attention.
        </p>
      ) : (
        <div
          className="ui-table-scroll"
          tabIndex={0}
          role="region"
          aria-labelledby="er-attention-heading"
        >
          <table className="ui-table er-table">
            <thead>
              <tr>
                <th scope="col">Issue</th>
                <th scope="col">Project</th>
                <th scope="col">Release</th>
                <th scope="col">Tracker</th>
                <th scope="col" className="ui-num">
                  Events
                </th>
                <th scope="col" className="ui-num">
                  Last seen
                </th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <td className="ui-lead">
                    <div className="er-issue-cell">
                      <StatusGlyph
                        severity={issueSeverity(issue)}
                        label={issueGlyphLabel(issue)}
                        hideLabel
                      />
                      <span className="er-issue-main">
                        <Link
                          className="er-issue-link"
                          to={`/issues/${encodeURIComponent(issue.id)}`}
                        >
                          <strong>{issue.type}</strong>
                          {issue.value.length > 0 ? (
                            <span className="er-issue-value">{`: ${issue.value}`}</span>
                          ) : null}
                        </Link>
                        {issue.transaction.length > 0 ? (
                          <span className="ui-muted er-issue-tx">
                            {issue.transaction}
                          </span>
                        ) : null}
                      </span>
                      {issue.regressedCount > 0 ? (
                        <Chip
                          label="Regressed"
                          value={issue.regressedCount}
                          severity="error"
                        />
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <Link
                      className="er-subtle-link ui-mono"
                      to={`/projects/${encodeURIComponent(issue.projectSlug)}`}
                    >
                      {issue.projectSlug}
                    </Link>
                  </td>
                  <td className="ui-mono ui-muted">
                    {issue.lastRelease ?? "—"}
                  </td>
                  <td>
                    {issue.trackerIssueIdentifier === null ? (
                      <span className="ui-muted">—</span>
                    ) : (
                      <a
                        className="er-chip-link"
                        href={trackerIssueUrl(issue.trackerIssueIdentifier)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Chip
                          label="Tracker"
                          value={issue.trackerIssueIdentifier}
                          severity="info"
                        />
                      </a>
                    )}
                  </td>
                  <td className="ui-num ui-mono">
                    {formatCount(issue.digestedEventCount)}
                  </td>
                  <td className="ui-num ui-mono ui-muted">
                    <time dateTime={issue.lastSeen}>
                      {formatAge(issue.lastSeen, nowMs)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CountCell({
  value,
  highlightError = false,
}: {
  readonly value: number;
  readonly highlightError?: boolean;
}): React.JSX.Element {
  if (value === 0) {
    return <td className="ui-num ui-mono ui-zero">0</td>;
  }
  if (highlightError) {
    return (
      <td className="ui-num ui-mono" data-sev="error">
        <Chip label="Regressed" value={value} severity="error" />
      </td>
    );
  }
  return <td className="ui-num ui-mono">{formatCount(value)}</td>;
}

function ProjectsSummarySection({
  projects,
}: {
  readonly projects: readonly ProjectSummary[];
}): React.JSX.Element {
  return (
    <section className="er-section" aria-labelledby="er-projects-heading">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="er-projects-heading">
          Projects
        </h2>
        <span className="ui-count">{formatCount(projects.length)}</span>
      </div>
      {projects.length === 0 ? (
        <p className="er-state">
          No projects registered yet. Create one in{" "}
          <Link className="er-subtle-link" to="/projects">
            Projects &amp; DSNs
          </Link>
          .
        </p>
      ) : (
        <div
          className="ui-table-scroll"
          tabIndex={0}
          role="region"
          aria-labelledby="er-projects-heading"
        >
          <table className="ui-table er-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="ui-num">
                  Unresolved
                </th>
                <th scope="col" className="ui-num">
                  Regressed
                </th>
                <th scope="col" className="ui-num">
                  Active 7d
                </th>
                <th scope="col" className="ui-num">
                  Muted
                </th>
                <th scope="col" className="ui-num">
                  Digested total
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link
                      className="er-issue-link ui-strong"
                      to={`/projects/${encodeURIComponent(project.slug)}`}
                    >
                      {project.name}
                    </Link>{" "}
                    <span className="ui-mono ui-muted">{project.slug}</span>
                  </td>
                  <CountCell value={project.unresolvedCount} />
                  <CountCell value={project.regressedCount} highlightError />
                  <CountCell value={project.activeIssues7d} />
                  <CountCell value={project.mutedCount} />
                  <CountCell value={project.digestedEventCount} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function OverviewView({
  overview,
  isRefreshing = false,
  onRefresh,
  nowMs,
}: {
  readonly overview: OverviewResponse;
  readonly isRefreshing?: boolean;
  readonly onRefresh: () => void;
  readonly nowMs?: number | undefined;
}): React.JSX.Element {
  const viewerMeta =
    overview.viewer.displayName ??
    overview.viewer.login ??
    `${formatCount(overview.totalStoredEvents)} stored events`;

  const figures: readonly Figure[] = [
    {
      label: "Unresolved",
      value: formatCount(overview.totalUnresolved),
      severity: overview.totalUnresolved > 0 ? "warning" : "ok",
    },
    {
      label: "Regressed",
      value: formatCount(overview.totalRegressed),
      severity: overview.totalRegressed > 0 ? "error" : "ok",
    },
    {
      label: "Active (7d)",
      value: formatCount(overview.activeIssues7d),
      hint: `${formatCount(overview.projects.length)} projects`,
    },
    {
      label: "Events (24h)",
      value: formatCount(overview.events24h),
      hint: `${formatCount(overview.totalDigestedEvents)} total`,
    },
  ];

  return (
    <main>
      <title>Errors</title>
      <HeaderBar
        title="Errors"
        meta={viewerMeta}
        actions={
          <Button disabled={isRefreshing} onClick={onRefresh}>
            <RefreshCwIcon aria-hidden="true" />
            Refresh
          </Button>
        }
      />
      <FigureStrip figures={figures} />
      <AttentionIssuesSection issues={overview.attentionIssues} nowMs={nowMs} />
      <ProjectsSummarySection projects={overview.projects} />
    </main>
  );
}

export function OverviewPage(): React.JSX.Element {
  const overviewQuery = useQuery({
    queryKey: queryKeys.overview,
    queryFn: ({ signal }) => fetchOverview(signal),
  });

  if (overviewQuery.isPending) {
    return (
      <main>
        <title>Errors</title>
        <HeaderBar title="Errors" />
        <p className="er-state" role="status">
          Loading error overview…
        </p>
      </main>
    );
  }

  if (overviewQuery.isError) {
    return (
      <main>
        <title>Errors</title>
        <HeaderBar title="Errors" />
        <div className="er-banner" data-sev="error" role="alert">
          <span>{overviewQuery.error.message}</span>
          <Button
            onClick={() => {
              void overviewQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </main>
    );
  }

  return (
    <OverviewView
      overview={overviewQuery.data}
      isRefreshing={overviewQuery.isFetching}
      onRefresh={() => {
        void overviewQuery.refetch();
      }}
    />
  );
}
