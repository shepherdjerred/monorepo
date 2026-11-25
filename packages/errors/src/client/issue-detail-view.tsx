import {
  Button,
  Chip,
  FigureStrip,
  HeaderBar,
  type Figure,
} from "@shepherdjerred/console-ui";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
} from "lucide-react";
import { Link } from "react-router";
import type {
  EventDetail,
  EventListItem,
  IssueDetail,
  IssueState,
} from "#shared/contract.ts";
import {
  formatAge,
  formatCount,
  formatTimestamp,
  issueSeverity,
  issueStateLabel,
  trackerIssueUrl,
} from "./format.ts";
import { EventInspectorPanels } from "./stacktrace-panel.tsx";

function IssueMetadataGrid({
  issue,
  activeEvent,
}: {
  readonly issue: IssueDetail;
  readonly activeEvent: EventDetail | null;
}): React.JSX.Element {
  return (
    <section className="er-meta-section" aria-label="Issue metadata">
      <dl className="er-meta-grid">
        <div>
          <dt>Project</dt>
          <dd>
            <Link
              className="er-subtle-link"
              to={`/projects/${encodeURIComponent(issue.projectSlug)}`}
            >
              {issue.projectName}
            </Link>
          </dd>
        </div>
        <div>
          <dt>Transaction</dt>
          <dd className="ui-mono">
            {activeEvent?.transaction ??
              (issue.transaction.length > 0 ? issue.transaction : "—")}
          </dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd className="ui-mono">{formatTimestamp(issue.firstSeen)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd className="ui-mono">{formatTimestamp(issue.lastSeen)}</dd>
        </div>
        <div>
          <dt>Release</dt>
          <dd className="ui-mono">
            {activeEvent?.release ?? issue.lastRelease ?? "—"}
          </dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd className="ui-mono">{activeEvent?.environment ?? "—"}</dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd className="ui-mono">{activeEvent?.platform ?? "—"}</dd>
        </div>
        <div>
          <dt>Fingerprint</dt>
          <dd className="ui-mono">{issue.primaryFingerprint}</dd>
        </div>
      </dl>
    </section>
  );
}

function EventOccurrenceToolbar({
  issueId,
  activeEvent,
  events,
}: {
  readonly issueId: string;
  readonly activeEvent: EventDetail | null;
  readonly events: readonly EventListItem[];
}): React.JSX.Element | null {
  if (activeEvent === null) {
    return null;
  }
  const activeIndex = events.findIndex((item) => item.id === activeEvent.id);
  const newerEvent = activeIndex > 0 ? (events[activeIndex - 1] ?? null) : null;
  const olderEvent =
    activeIndex !== -1 && activeIndex < events.length - 1
      ? (events[activeIndex + 1] ?? null)
      : null;
  const isLatest = activeIndex <= 0;
  const shortEventId = activeEvent.eventId.slice(0, 8);

  return (
    <div className="ui-toolbar er-event-bar">
      <div className="er-event-summary">
        <span className="ui-mono ui-strong">{`Event ${shortEventId}`}</span>
        <span className="ui-mono ui-muted">
          {formatTimestamp(activeEvent.timestamp)}
        </span>
        <Chip label="Level" value={activeEvent.level} />
      </div>
      <div className="er-event-nav">
        {isLatest ? (
          <Button disabled>Latest</Button>
        ) : (
          <Link
            className="ui-btn"
            data-variant="default"
            to={`/issues/${encodeURIComponent(issueId)}`}
          >
            Latest
          </Link>
        )}
        {newerEvent === null ? (
          <Button disabled aria-label="Newer event">
            <ChevronLeftIcon aria-hidden="true" />
            Newer
          </Button>
        ) : (
          <Link
            className="ui-btn"
            data-variant="default"
            to={`/issues/${encodeURIComponent(issueId)}/events/${encodeURIComponent(newerEvent.id)}`}
          >
            <ChevronLeftIcon aria-hidden="true" />
            Newer
          </Link>
        )}
        {olderEvent === null ? (
          <Button disabled aria-label="Older event">
            Older
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        ) : (
          <Link
            className="ui-btn"
            data-variant="default"
            to={`/issues/${encodeURIComponent(issueId)}/events/${encodeURIComponent(olderEvent.id)}`}
          >
            Older
            <ChevronRightIcon aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}

function DetailHeaderActions({
  issue,
  activeEvent,
  isMutating,
  copiedMarkdown,
  onUpdateState,
  onOpenCreateTrackerDialog,
  onCopyMarkdown,
}: {
  readonly issue: IssueDetail;
  readonly activeEvent: EventDetail | null;
  readonly isMutating: boolean;
  readonly copiedMarkdown: boolean;
  readonly onUpdateState: (state: IssueState) => void;
  readonly onOpenCreateTrackerDialog: () => void;
  readonly onCopyMarkdown: () => void;
}): React.JSX.Element {
  const isResolved =
    issue.state === "RESOLVED" || issue.state === "RESOLVED_NEXT_RELEASE";

  return (
    <>
      {isResolved ? (
        <Button
          disabled={isMutating}
          onClick={() => {
            onUpdateState("OPEN");
          }}
        >
          Reopen
        </Button>
      ) : (
        <Button
          variant="primary"
          disabled={isMutating}
          onClick={() => {
            onUpdateState("RESOLVED");
          }}
        >
          Resolve
        </Button>
      )}
      <Button
        disabled={isMutating || issue.state === "RESOLVED_NEXT_RELEASE"}
        onClick={() => {
          onUpdateState("RESOLVED_NEXT_RELEASE");
        }}
      >
        Next release
      </Button>
      <Button
        disabled={isMutating}
        onClick={() => {
          onUpdateState(issue.state === "MUTED" ? "OPEN" : "MUTED");
        }}
      >
        {issue.state === "MUTED" ? "Unmute" : "Mute"}
      </Button>
      {issue.trackerIssueIdentifier === null ? (
        <Button disabled={isMutating} onClick={onOpenCreateTrackerDialog}>
          Create AI Issue
        </Button>
      ) : (
        <a
          className="ui-btn"
          data-variant="default"
          href={trackerIssueUrl(issue.trackerIssueIdentifier)}
          target="_blank"
          rel="noreferrer"
        >
          {`Open ${issue.trackerIssueIdentifier} ↗`}
        </a>
      )}
      <Button
        disabled={activeEvent === null || activeEvent.stacktraceMd.length === 0}
        onClick={onCopyMarkdown}
      >
        {copiedMarkdown ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
        {copiedMarkdown ? "Copied" : "Copy Markdown"}
      </Button>
    </>
  );
}

export type IssueDetailViewProps = {
  readonly issue: IssueDetail;
  readonly activeEvent: EventDetail | null;
  readonly events: readonly EventListItem[];
  readonly isMutating?: boolean;
  readonly copiedMarkdown?: boolean;
  readonly actionError?: string | null;
  readonly nowMs?: number | undefined;
  readonly onUpdateState: (state: IssueState) => void;
  readonly onOpenCreateTrackerDialog: () => void;
  readonly onCopyMarkdown: () => void;
};

export function IssueDetailView(
  props: IssueDetailViewProps,
): React.JSX.Element {
  const {
    issue,
    activeEvent,
    events,
    isMutating = false,
    copiedMarkdown = false,
    actionError = null,
    nowMs,
  } = props;

  const figures: readonly Figure[] = [
    {
      label: "State",
      value: issueStateLabel(issue.state),
      hint:
        issue.resolvedInRelease === null
          ? issue.level
          : `in ${issue.resolvedInRelease}`,
      severity: issueSeverity(issue),
    },
    {
      label: "Events",
      value: formatCount(issue.digestedEventCount),
      hint: `${formatCount(issue.storedEventCount)} stored / ${formatCount(issue.digestedEventCount)} total`,
    },
    {
      label: "Regressions",
      value: formatCount(issue.regressedCount),
      severity: issue.regressedCount > 0 ? "error" : "ok",
    },
    {
      label: "Last seen",
      value: formatAge(issue.lastSeen, nowMs),
      hint: formatTimestamp(issue.lastSeen),
    },
  ];

  return (
    <main>
      <title>{`${issue.type} · Errors`}</title>
      <div className="er-subbar">
        <Link
          className="er-back-link"
          to={`/projects/${encodeURIComponent(issue.projectSlug)}`}
        >
          <ArrowLeftIcon aria-hidden="true" />
          {issue.projectName}
        </Link>
        {issue.trackerIssueIdentifier === null ? null : (
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
      </div>

      <HeaderBar
        title={issue.type}
        actions={
          <DetailHeaderActions
            issue={issue}
            activeEvent={activeEvent}
            isMutating={isMutating}
            copiedMarkdown={copiedMarkdown}
            onUpdateState={props.onUpdateState}
            onOpenCreateTrackerDialog={props.onOpenCreateTrackerDialog}
            onCopyMarkdown={props.onCopyMarkdown}
          />
        }
      />

      {issue.value.length > 0 ? (
        <div className="er-detail-subtitle">{issue.value}</div>
      ) : null}

      {actionError === null ? null : (
        <div className="er-banner" data-sev="error" role="alert">
          <span>{actionError}</span>
        </div>
      )}

      <FigureStrip figures={figures} />
      <IssueMetadataGrid issue={issue} activeEvent={activeEvent} />
      <EventOccurrenceToolbar
        issueId={issue.id}
        activeEvent={activeEvent}
        events={events}
      />
      <EventInspectorPanels event={activeEvent} />
    </main>
  );
}
