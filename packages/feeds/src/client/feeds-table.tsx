import { useId, useRef, type MouseEvent } from "react";
import { Button, Chip, StatusGlyph } from "@shepherdjerred/console-ui";
import type { FeedHealthItem } from "@shepherdjerred/feeds/shared/contract.ts";
import {
  feedHealthStatus,
  formatAutoReadBadge,
  formatIsoTimestamp,
  formatRelativeTime,
  sortFeedsForHealth,
} from "./model.ts";
import {
  DIALOG_LIGHT_DISMISS_PROPS,
  useModalDialogRef,
} from "./user-feed-dialog.tsx";

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export type FeedsTableProps = {
  readonly feeds: readonly FeedHealthItem[];
  readonly nowSeconds?: number | undefined;
  readonly deletingId?: number | undefined;
  readonly onEdit: (feed: FeedHealthItem) => void;
  readonly onDelete: (feed: FeedHealthItem) => void;
  readonly onNavigate?: ((href: string) => void) | undefined;
};

export function FeedsTable({
  feeds,
  nowSeconds,
  deletingId,
  onEdit,
  onDelete,
  onNavigate,
}: FeedsTableProps): React.JSX.Element {
  const orderedFeeds = sortFeedsForHealth(feeds);
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Configured feeds"
      className="ui-table-scroll fd-table-wrap"
    >
      <table className="ui-table fd-feeds-table">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Feed</th>
            <th scope="col">Category</th>
            <th scope="col">Source</th>
            <th scope="col">Endpoint &amp; Rules</th>
            <th scope="col">Last Poll</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orderedFeeds.map((feed) => {
            const status = feedHealthStatus(feed);
            const feedHref = `/feed/${String(feed.id)}`;
            const polledIso =
              feed.lastPolledAt === null
                ? undefined
                : formatIsoTimestamp(feed.lastPolledAt);
            const polledRelative = formatRelativeTime(
              feed.lastPolledAt,
              nowSeconds,
            );
            const isDeleting = deletingId === feed.id;

            return (
              <tr key={feed.id}>
                <td className="fd-feed-status">
                  <StatusGlyph
                    severity={status.severity}
                    label={status.label}
                  />
                </td>
                <th scope="row" className="fd-feed-name">
                  <div className="fd-entry-title-row">
                    <a
                      href={feedHref}
                      className="fd-entry-link"
                      onClick={(event) => {
                        if (
                          onNavigate !== undefined &&
                          isPlainLeftClick(event)
                        ) {
                          event.preventDefault();
                          onNavigate(feedHref);
                        }
                      }}
                    >
                      {feed.title}
                    </a>
                    {feed.unreadCount > 0 ? (
                      <Chip label="Unread" value={feed.unreadCount} />
                    ) : null}
                    {feed.hidden ? (
                      <Chip label="Stream" value="Hidden" severity="unknown" />
                    ) : null}
                  </div>
                </th>
                <td className="fd-feed-category">{feed.category}</td>
                <td className="fd-feed-source">
                  <Chip
                    label="Source"
                    value={feed.source === "code" ? "Code" : "User"}
                    {...(feed.source === "user" ? { severity: "info" } : {})}
                  />
                </td>
                <td className="fd-feed-endpoint">
                  <div className="fd-endpoint-stack">
                    <span className="ui-mono fd-url" title={feed.displayUrl}>
                      {feed.displayUrl}
                    </span>
                    {feed.autoRead === null ? null : (
                      <Chip
                        label="Auto-read"
                        value={formatAutoReadBadge(feed.autoRead)}
                      />
                    )}
                  </div>
                </td>
                <td className="fd-feed-poll">
                  <div className="fd-poll-stack">
                    <div className="fd-poll-line">
                      {feed.lastStatus === null ? null : (
                        <span className="ui-mono">
                          HTTP {String(feed.lastStatus)}
                        </span>
                      )}
                      {polledIso === undefined ? (
                        <span className="ui-muted">Never</span>
                      ) : (
                        <time
                          className="ui-mono fd-time"
                          dateTime={polledIso}
                          title={polledIso}
                        >
                          {polledRelative}
                        </time>
                      )}
                      {feed.consecutiveFailures > 0 ? (
                        <span className="fd-failure-streak">
                          ({String(feed.consecutiveFailures)} failed)
                        </span>
                      ) : null}
                    </div>
                    {feed.lastError === null ? null : (
                      <p className="fd-feed-error" title={feed.lastError}>
                        {feed.lastError}
                      </p>
                    )}
                  </div>
                </td>
                <td className="fd-feed-actions">
                  {feed.source === "user" ? (
                    <div className="fd-row-actions">
                      <Button
                        type="button"
                        onClick={() => {
                          onEdit(feed);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => {
                          onDelete(feed);
                        }}
                      >
                        {isDeleting ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  ) : (
                    <span className="ui-muted">Code</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FeedsSection({
  feeds,
  isPending,
  errorMessage,
  deletingId,
  onEditFeed,
  onDeleteFeed,
  onNavigate,
}: {
  readonly feeds: readonly FeedHealthItem[] | undefined;
  readonly isPending: boolean;
  readonly errorMessage: string | undefined;
  readonly deletingId: number | undefined;
  readonly onEditFeed: (feed: FeedHealthItem) => void;
  readonly onDeleteFeed: (feed: FeedHealthItem) => void;
  readonly onNavigate: (href: string) => void;
}): React.JSX.Element {
  if (isPending) return <p className="fd-empty">Loading feeds…</p>;
  if (errorMessage !== undefined) {
    return (
      <p className="fd-empty" role="alert">
        {errorMessage}
      </p>
    );
  }
  if (feeds === undefined || feeds.length === 0) {
    return <p className="fd-empty">No feeds configured.</p>;
  }
  return (
    <FeedsTable
      feeds={feeds}
      deletingId={deletingId}
      onEdit={onEditFeed}
      onDelete={onDeleteFeed}
      onNavigate={onNavigate}
    />
  );
}

export function DeleteFeedDialog({
  target,
  isDeleting,
  onClose,
  onConfirm,
}: {
  readonly target: FeedHealthItem | undefined;
  readonly isDeleting: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dialogRefCallback = useModalDialogRef(dialogRef, target !== undefined);

  return (
    <dialog
      {...DIALOG_LIGHT_DISMISS_PROPS}
      ref={dialogRefCallback}
      className="fd-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        if (dialogRef.current !== null) dialogRef.current.returnValue = "";
        onClose();
      }}
    >
      <h1 id={titleId} className="fd-dialog-title">
        Delete user feed?
      </h1>
      <p className="ui-muted">
        Remove <strong className="ui-strong">{target?.title ?? ""}</strong> and
        all of its stored entries?
      </p>
      <div className="fd-dialog-actions">
        <Button
          type="button"
          autoFocus
          onClick={() => {
            dialogRef.current?.close("cancel");
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={isDeleting}
          onClick={onConfirm}
        >
          {isDeleting ? "Deleting…" : "Delete feed"}
        </Button>
      </div>
    </dialog>
  );
}
