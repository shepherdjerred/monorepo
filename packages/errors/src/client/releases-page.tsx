import { Button, Field, HeaderBar } from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { ProjectSummary, ReleaseItem } from "#shared/contract.ts";
import { fetchProjects, fetchReleases, queryKeys } from "./api.ts";
import { formatAge, formatCount, formatTimestamp } from "./format.ts";

export function ReleasesView({
  releases,
  projects,
  projectFilter,
  isRefreshing = false,
  nowMs,
  onProjectFilterChange,
  onRefresh,
}: {
  readonly releases: readonly ReleaseItem[];
  readonly projects: readonly ProjectSummary[];
  readonly projectFilter: string;
  readonly isRefreshing?: boolean;
  readonly nowMs?: number | undefined;
  readonly onProjectFilterChange: (next: string) => void;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  return (
    <main>
      <title>Releases · Errors</title>
      <HeaderBar
        title="Releases"
        meta={`${formatCount(releases.length)} ${releases.length === 1 ? "release" : "releases"}`}
        actions={
          <Button disabled={isRefreshing} onClick={onRefresh}>
            <RefreshCwIcon aria-hidden="true" />
            Refresh
          </Button>
        }
      />
      <div className="ui-toolbar">
        <Field label="Project" layout="inline">
          {(control) => (
            <select
              {...control}
              value={projectFilter}
              onChange={(event) => {
                onProjectFilterChange(event.currentTarget.value);
              }}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <span className="ui-count" aria-live="polite">
          {`${formatCount(releases.length)} shown`}
        </span>
      </div>

      {releases.length === 0 ? (
        <p className="er-state">No releases recorded yet.</p>
      ) : (
        <div
          className="ui-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Releases"
        >
          <table className="ui-table er-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Version</th>
                <th scope="col" className="ui-num">
                  Released at
                </th>
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => (
                <tr key={release.id}>
                  <td>
                    <Link
                      className="er-subtle-link ui-mono"
                      to={`/projects/${encodeURIComponent(release.projectSlug)}`}
                    >
                      {release.projectSlug}
                    </Link>
                  </td>
                  <td className="ui-mono">
                    <Link
                      className="er-issue-link"
                      to={`/issues?project=${encodeURIComponent(release.projectSlug)}&release=${encodeURIComponent(release.version)}&tab=all`}
                    >
                      {release.version}
                    </Link>
                  </td>
                  <td className="ui-num ui-mono ui-muted">
                    <time
                      dateTime={release.releasedAt}
                      title={formatTimestamp(release.releasedAt)}
                    >
                      {`${formatTimestamp(release.releasedAt)} (${formatAge(release.releasedAt, nowMs)})`}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export function ReleasesPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get("project") ?? "";

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => fetchProjects(signal),
  });

  const releasesQuery = useQuery({
    queryKey: queryKeys.releases(projectFilter),
    queryFn: ({ signal }) =>
      fetchReleases(
        projectFilter.length > 0 ? projectFilter : undefined,
        signal,
      ),
  });

  const handleProjectChange = (next: string): void => {
    const updated = new URLSearchParams(searchParams);
    if (next.length === 0) {
      updated.delete("project");
    } else {
      updated.set("project", next);
    }
    setSearchParams(updated);
  };

  if (releasesQuery.isPending) {
    return (
      <main>
        <title>Releases · Errors</title>
        <HeaderBar title="Releases" />
        <p className="er-state" role="status">
          Loading releases…
        </p>
      </main>
    );
  }

  if (releasesQuery.isError) {
    return (
      <main>
        <title>Releases · Errors</title>
        <HeaderBar title="Releases" />
        <div className="er-banner" data-sev="error" role="alert">
          <span>{releasesQuery.error.message}</span>
          <Button
            onClick={() => {
              void releasesQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </main>
    );
  }

  return (
    <ReleasesView
      releases={releasesQuery.data.items}
      projects={projectsQuery.data ?? []}
      projectFilter={projectFilter}
      isRefreshing={releasesQuery.isFetching}
      onProjectFilterChange={handleProjectChange}
      onRefresh={() => {
        void Promise.all([releasesQuery.refetch(), projectsQuery.refetch()]);
      }}
    />
  );
}
