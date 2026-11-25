import { Button, HeaderBar } from "@shepherdjerred/console-ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import type {
  CreateProjectInput,
  ProjectSummary,
  UpdateProjectInput,
} from "#shared/contract.ts";
import {
  createProject,
  fetchProjects,
  queryKeys,
  updateProject,
} from "./api.ts";
import { formatCount } from "./format.ts";
import { NewProjectDialog } from "./project-dialogs.tsx";

const RETENTION_CHOICES: readonly number[] = [10, 25, 50, 100, 250, 500, 1000];

export type ProjectsViewProps = {
  readonly projects: readonly ProjectSummary[];
  readonly copiedProjectId: number | null;
  readonly updatingProjectId?: number | null;
  readonly isRefreshing?: boolean;
  readonly mutationError?: string | null;
  readonly onCopyDsn: (project: ProjectSummary) => void;
  readonly onUpdateProject: (id: number, patch: UpdateProjectInput) => void;
  readonly onOpenCreateDialog: () => void;
  readonly onRefresh: () => void;
};

export function ProjectsView(props: ProjectsViewProps): React.JSX.Element {
  const {
    projects,
    copiedProjectId,
    updatingProjectId = null,
    isRefreshing = false,
    mutationError = null,
  } = props;

  return (
    <main>
      <title>Projects &amp; DSNs · Errors</title>
      <HeaderBar
        title="Projects & DSNs"
        meta={`${formatCount(projects.length)} ${projects.length === 1 ? "project" : "projects"}`}
        actions={
          <>
            <Button variant="primary" onClick={props.onOpenCreateDialog}>
              <PlusIcon aria-hidden="true" />
              New project
            </Button>
            <Button disabled={isRefreshing} onClick={props.onRefresh}>
              <RefreshCwIcon aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />

      {mutationError === null ? null : (
        <div className="er-banner" data-sev="error" role="alert">
          <span>{mutationError}</span>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="er-state">
          No projects configured yet. Click + New project to issue a DSN.
        </p>
      ) : (
        <div
          className="ui-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Projects and DSNs"
        >
          <table className="ui-table er-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Name</th>
                <th scope="col">Public DSN</th>
                <th scope="col">Alert policy</th>
                <th scope="col">Retention</th>
                <th scope="col" className="ui-num">
                  Open
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const isCopied = copiedProjectId === project.id;
                const isUpdating = updatingProjectId === project.id;
                const retentionOptions = RETENTION_CHOICES.includes(
                  project.retentionMaxEvents,
                )
                  ? RETENTION_CHOICES
                  : [project.retentionMaxEvents, ...RETENTION_CHOICES].sort(
                      (left, right) => left - right,
                    );

                return (
                  <tr key={project.id}>
                    <td className="ui-mono ui-muted">{project.id}</td>
                    <td>
                      <Link
                        className="er-issue-link ui-strong"
                        to={`/projects/${encodeURIComponent(project.slug)}`}
                      >
                        {project.name}
                      </Link>{" "}
                      <span className="ui-mono ui-muted">{project.slug}</span>
                    </td>
                    <td>
                      <div className="er-dsn-cell">
                        <code className="er-dsn-code ui-mono">
                          {project.dsn}
                        </code>
                        <Button
                          aria-label={`Copy DSN for ${project.name}`}
                          onClick={() => {
                            props.onCopyDsn(project);
                          }}
                        >
                          {isCopied ? (
                            <CheckIcon aria-hidden="true" />
                          ) : (
                            <CopyIcon aria-hidden="true" />
                          )}
                          {isCopied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </td>
                    <td>
                      <div className="er-policy-group">
                        <label className="er-toggle-label">
                          <input
                            type="checkbox"
                            className="er-checkbox"
                            disabled={isUpdating}
                            checked={project.alertOnNewIssue}
                            onChange={(event) => {
                              props.onUpdateProject(project.id, {
                                alertOnNewIssue: event.currentTarget.checked,
                              });
                            }}
                          />
                          New issue
                        </label>
                        <label className="er-toggle-label">
                          <input
                            type="checkbox"
                            className="er-checkbox"
                            disabled={isUpdating}
                            checked={project.alertOnRegression}
                            onChange={(event) => {
                              props.onUpdateProject(project.id, {
                                alertOnRegression: event.currentTarget.checked,
                              });
                            }}
                          />
                          Regression
                        </label>
                      </div>
                    </td>
                    <td>
                      <select
                        className="ui-field-control ui-mono"
                        aria-label={`Retention max events for ${project.name}`}
                        disabled={isUpdating}
                        value={String(project.retentionMaxEvents)}
                        onChange={(event) => {
                          const nextVal = Number.parseInt(
                            event.currentTarget.value,
                            10,
                          );
                          if (Number.isFinite(nextVal)) {
                            props.onUpdateProject(project.id, {
                              retentionMaxEvents: nextVal,
                            });
                          }
                        }}
                      >
                        {retentionOptions.map((choice) => (
                          <option key={choice} value={String(choice)}>
                            {`${String(choice)} events`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      className={
                        project.unresolvedCount === 0
                          ? "ui-num ui-mono ui-zero"
                          : "ui-num ui-mono"
                      }
                    >
                      {formatCount(project.unresolvedCount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export function ProjectsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [copiedProjectId, setCopiedProjectId] = useState<number | null>(null);
  const copyTimerRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | undefined
  >(undefined);

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => fetchProjects(signal),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(input),
    onSuccess: async () => {
      setCreateOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      readonly id: number;
      readonly patch: UpdateProjectInput;
    }) => updateProject(id, patch),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]);
    },
  });

  if (projectsQuery.isPending) {
    return (
      <main>
        <title>Projects &amp; DSNs · Errors</title>
        <HeaderBar title="Projects & DSNs" />
        <p className="er-state" role="status">
          Loading projects…
        </p>
      </main>
    );
  }

  if (projectsQuery.isError) {
    return (
      <main>
        <title>Projects &amp; DSNs · Errors</title>
        <HeaderBar title="Projects & DSNs" />
        <div className="er-banner" data-sev="error" role="alert">
          <span>{projectsQuery.error.message}</span>
          <Button
            onClick={() => {
              void projectsQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </main>
    );
  }

  const handleCopyDsn = (project: ProjectSummary): void => {
    void (async () => {
      try {
        await globalThis.navigator.clipboard.writeText(project.dsn);
        setCopiedProjectId(project.id);
        if (copyTimerRef.current !== undefined) {
          globalThis.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = globalThis.setTimeout(() => {
          setCopiedProjectId(null);
        }, 1800);
      } catch {
        // Ignore clipboard errors cleanly.
      }
    })();
  };

  return (
    <>
      <ProjectsView
        projects={projectsQuery.data}
        copiedProjectId={copiedProjectId}
        updatingProjectId={
          updateMutation.isPending ? updateMutation.variables.id : null
        }
        isRefreshing={projectsQuery.isFetching}
        mutationError={
          updateMutation.isError ? updateMutation.error.message : null
        }
        onCopyDsn={handleCopyDsn}
        onUpdateProject={(id, patch) => {
          updateMutation.mutate({ id, patch });
        }}
        onOpenCreateDialog={() => {
          setCreateOpen(true);
        }}
        onRefresh={() => {
          void projectsQuery.refetch();
        }}
      />
      <NewProjectDialog
        key={String(createOpen)}
        open={createOpen}
        isSubmitting={createMutation.isPending}
        errorMessage={
          createMutation.isError ? createMutation.error.message : null
        }
        onOpenChange={setCreateOpen}
        onSubmit={(input) => {
          createMutation.mutate(input);
        }}
      />
    </>
  );
}
