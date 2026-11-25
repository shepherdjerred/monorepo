import {
  Button,
  Chip,
  Field,
  HeaderBar,
  StatusGlyph,
  Tabs,
  type TabOption,
} from "@shepherdjerred/console-ui";
import { CheckIcon, CopyIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import {
  IssueSortSchema,
  type IssueFilterTab,
  type IssueListItem,
  type IssueSort,
  type IssueState,
  type ProjectSummary,
} from "#shared/contract.ts";
import {
  formatAge,
  formatCount,
  issueGlyphLabel,
  issueSeverity,
  trackerIssueUrl,
} from "./format.ts";

export function parseSortParam(raw: string | null): IssueSort {
  const parsed = IssueSortSchema.safeParse(raw);
  return parsed.success ? parsed.data : "last_seen";
}

function buildTabOptions(
  project: ProjectSummary | undefined,
): readonly TabOption<IssueFilterTab>[] {
  return [
    {
      value: "unresolved",
      label: "Unresolved",
      ...(project === undefined ? {} : { count: project.unresolvedCount }),
    },
    {
      value: "regressed",
      label: "Regressed",
      ...(project !== undefined && project.regressedCount > 0
        ? { count: project.regressedCount }
        : {}),
    },
    {
      value: "muted",
      label: "Muted",
      ...(project !== undefined && project.mutedCount > 0
        ? { count: project.mutedCount }
        : {}),
    },
    { value: "resolved", label: "Resolved" },
    { value: "all", label: "All" },
  ];
}

function BulkActionsBar({
  selectedCount,
  isMutating,
  onBulkState,
  onClear,
}: {
  readonly selectedCount: number;
  readonly isMutating: boolean;
  readonly onBulkState: (state: IssueState) => void;
  readonly onClear: () => void;
}): React.JSX.Element | null {
  if (selectedCount === 0) {
    return null;
  }
  return (
    <div className="er-bulk-bar" role="group" aria-label="Bulk issue actions">
      <Button
        variant="primary"
        disabled={isMutating}
        onClick={() => {
          onBulkState("RESOLVED");
        }}
      >
        Resolve
      </Button>
      <Button
        disabled={isMutating}
        onClick={() => {
          onBulkState("RESOLVED_NEXT_RELEASE");
        }}
      >
        Next release
      </Button>
      <Button
        disabled={isMutating}
        onClick={() => {
          onBulkState("MUTED");
        }}
      >
        Mute
      </Button>
      <Button
        disabled={isMutating}
        onClick={() => {
          onBulkState("OPEN");
        }}
      >
        Reopen
      </Button>
      <Button disabled={isMutating} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

function IssuesHeaderActions({
  projectSummary,
  copiedDsn,
  isRefreshing,
  onCopyDsn,
  onRefresh,
}: {
  readonly projectSummary: ProjectSummary | undefined;
  readonly copiedDsn: boolean;
  readonly isRefreshing: boolean;
  readonly onCopyDsn: (() => void) | undefined;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  return (
    <>
      {projectSummary === undefined ? null : (
        <>
          <Chip label="DSN" value={projectSummary.dsn} />
          {onCopyDsn === undefined ? null : (
            <Button onClick={onCopyDsn}>
              {copiedDsn ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {copiedDsn ? "Copied" : "Copy DSN"}
            </Button>
          )}
          <Link className="ui-btn" data-variant="default" to="/projects">
            <SettingsIcon aria-hidden="true" />
            Settings
          </Link>
        </>
      )}
      <Button disabled={isRefreshing} onClick={onRefresh}>
        <RefreshCwIcon aria-hidden="true" />
        Refresh
      </Button>
    </>
  );
}

function IssuesTable({
  items,
  selectedIds,
  showProjectBadge,
  onToggleAll,
  onToggleOne,
  nowMs,
}: {
  readonly items: readonly IssueListItem[];
  readonly selectedIds: ReadonlySet<string>;
  readonly showProjectBadge: boolean;
  readonly onToggleAll: (checked: boolean) => void;
  readonly onToggleOne: (id: string, checked: boolean) => void;
  readonly nowMs?: number | undefined;
}): React.JSX.Element {
  const allSelected =
    items.length > 0 && items.every((item) => selectedIds.has(item.id));

  if (items.length === 0) {
    return <p className="er-state">No issues match the current filters.</p>;
  }

  return (
    <div
      className="ui-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Issues list"
    >
      <table className="ui-table er-table">
        <thead>
          <tr>
            <th scope="col" className="er-check-col">
              <input
                type="checkbox"
                className="er-checkbox"
                aria-label="Select all visible issues"
                checked={allSelected}
                onChange={(event) => {
                  onToggleAll(event.currentTarget.checked);
                }}
              />
            </th>
            <th scope="col">Issue</th>
            <th scope="col">Tracker</th>
            <th scope="col">Release</th>
            <th scope="col" className="ui-num">
              Events
            </th>
            <th scope="col" className="ui-num">
              Last seen
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((issue) => {
            const isChecked = selectedIds.has(issue.id);
            return (
              <tr key={issue.id} {...(isChecked ? { "data-current": "" } : {})}>
                <td className="er-check-col">
                  <input
                    type="checkbox"
                    className="er-checkbox"
                    aria-label={`Select ${issue.type}: ${issue.value}`}
                    checked={isChecked}
                    onChange={(event) => {
                      onToggleOne(issue.id, event.currentTarget.checked);
                    }}
                  />
                </td>
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
                    {showProjectBadge ? (
                      <Link
                        className="er-subtle-link ui-mono"
                        to={`/projects/${encodeURIComponent(issue.projectSlug)}`}
                      >
                        {issue.projectSlug}
                      </Link>
                    ) : null}
                  </div>
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
                <td className="ui-mono ui-muted">{issue.lastRelease ?? "—"}</td>
                <td className="ui-num ui-mono">
                  {formatCount(issue.digestedEventCount)}
                </td>
                <td className="ui-num ui-mono ui-muted">
                  <time dateTime={issue.lastSeen}>
                    {formatAge(issue.lastSeen, nowMs)}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type IssuesInboxViewProps = {
  readonly title: string;
  readonly tab: IssueFilterTab;
  readonly query: string;
  readonly sort: IssueSort;
  readonly projectFilter: string;
  readonly lockedProjectSlug?: string | undefined;
  readonly projectSummary?: ProjectSummary | undefined;
  readonly projects: readonly ProjectSummary[];
  readonly items: readonly IssueListItem[];
  readonly selectedIds: ReadonlySet<string>;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly isRefreshing?: boolean;
  readonly isMutating?: boolean;
  readonly copiedDsn?: boolean;
  readonly mutationError?: string | null;
  readonly nowMs?: number | undefined;
  readonly onTabChange: (next: IssueFilterTab) => void;
  readonly onQueryChange: (next: string) => void;
  readonly onProjectFilterChange: (next: string) => void;
  readonly onSortChange: (next: IssueSort) => void;
  readonly onToggleAll: (checked: boolean) => void;
  readonly onToggleOne: (id: string, checked: boolean) => void;
  readonly onBulkState: (state: IssueState) => void;
  readonly onClearSelection: () => void;
  readonly onLoadMore: () => void;
  readonly onRefresh: () => void;
  readonly onCopyDsn?: () => void;
};

export function IssuesInboxView(
  props: IssuesInboxViewProps,
): React.JSX.Element {
  const {
    title,
    tab,
    query,
    sort,
    projectFilter,
    lockedProjectSlug,
    projectSummary,
    projects,
    items,
    selectedIds,
    hasNextPage,
    isFetchingNextPage = false,
    isRefreshing = false,
    isMutating = false,
    copiedDsn = false,
    mutationError = null,
    nowMs,
  } = props;

  const tabOptions = useMemo(
    () => buildTabOptions(projectSummary),
    [projectSummary],
  );
  const issueWord = items.length === 1 ? "issue" : "issues";
  const countAnnouncement =
    selectedIds.size > 0
      ? `${formatCount(selectedIds.size)} selected of ${formatCount(items.length)}`
      : `${formatCount(items.length)} ${issueWord}`;

  return (
    <main>
      <title>{`${title} · Errors`}</title>
      <HeaderBar
        title={title}
        tabs={
          <Tabs
            label="Filter issues"
            options={tabOptions}
            value={tab}
            onChange={props.onTabChange}
          />
        }
        actions={
          <IssuesHeaderActions
            projectSummary={projectSummary}
            copiedDsn={copiedDsn}
            isRefreshing={isRefreshing}
            onCopyDsn={props.onCopyDsn}
            onRefresh={props.onRefresh}
          />
        }
      />

      {mutationError === null ? null : (
        <div className="er-banner" data-sev="error" role="alert">
          <span>{mutationError}</span>
        </div>
      )}

      <div className="ui-toolbar">
        <Field label="Search" layout="inline">
          {(control) => (
            <input
              {...control}
              type="search"
              className={`${control.className} er-search-input`}
              value={query}
              placeholder="Type, message, fingerprint…"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                props.onQueryChange(event.currentTarget.value);
              }}
            />
          )}
        </Field>

        {lockedProjectSlug === undefined ? (
          <Field label="Project" layout="inline">
            {(control) => (
              <select
                {...control}
                value={projectFilter}
                onChange={(event) => {
                  props.onProjectFilterChange(event.currentTarget.value);
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
        ) : null}

        <Field label="Sort" layout="inline">
          {(control) => (
            <select
              {...control}
              value={sort}
              onChange={(event) => {
                props.onSortChange(parseSortParam(event.currentTarget.value));
              }}
            >
              <option value="last_seen">Last seen</option>
              <option value="events">Most events</option>
              <option value="first_seen">First seen</option>
            </select>
          )}
        </Field>

        <span className="ui-count" aria-live="polite">
          {countAnnouncement}
        </span>

        <div className="er-toolbar-spacer">
          <BulkActionsBar
            selectedCount={selectedIds.size}
            isMutating={isMutating}
            onBulkState={props.onBulkState}
            onClear={props.onClearSelection}
          />
        </div>
      </div>

      <IssuesTable
        items={items}
        selectedIds={selectedIds}
        showProjectBadge={lockedProjectSlug === undefined}
        onToggleAll={props.onToggleAll}
        onToggleOne={props.onToggleOne}
        nowMs={nowMs}
      />

      {hasNextPage ? (
        <div className="ui-section-foot">
          <Button disabled={isFetchingNextPage} onClick={props.onLoadMore}>
            {isFetchingNextPage ? "Loading more…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
