import { Tabs } from "@shepherdjerred/console-ui";
import { ArchiveIcon, ArchiveRestoreIcon, PinIcon } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { InboxBoard } from "#client/data/api.ts";
import { useArchive, useSetKeep } from "#client/data/mutations.ts";
import { useInbox } from "#client/data/queries.ts";
import { useLiveUpdates } from "#client/data/live.ts";
import { expiryNote } from "#client/lib/expiry.ts";
import { formatAge, formatBytes } from "#client/lib/format.ts";
import { Dialog } from "#client/shell/dialog.tsx";

export type InboxTab = "review" | "active" | "kept" | "archived";
const TABS: readonly InboxTab[] = ["review", "active", "kept", "archived"];

export function inTab(board: InboxBoard, tab: InboxTab): boolean {
  const archived = board.archivedAt !== null;
  switch (tab) {
    case "review":
      return (
        !archived && (board.needsReviewCount > 0 || board.unhandledCount > 0)
      );
    case "active":
      return !archived;
    case "kept":
      return !archived && board.keep;
    case "archived":
      return archived;
  }
}

const EMPTY: Readonly<Record<InboxTab, string>> = {
  review: "Nothing needs your review.",
  active: "No boards yet. Agents publish with toolkit artifacts publish.",
  kept: "No kept boards. Keep a board to stop it expiring.",
  archived: "No archived boards.",
};

function Row({
  board,
  onArchive,
}: {
  readonly board: InboxBoard;
  readonly onArchive: (board: InboxBoard) => void;
}): React.JSX.Element {
  const keep = useSetKeep();
  const archive = useArchive();
  const expiry = expiryNote(board);
  const archived = board.archivedAt !== null;
  return (
    <li className="ar-row" data-testid="inbox-row">
      <Link className="ar-row-main" to={`/b/${board.slug}`}>
        <span className="ar-row-title">{board.title}</span>
        <span className="ar-row-meta">
          <span>
            {board.artifactCount}{" "}
            {board.artifactCount === 1 ? "artifact" : "artifacts"}
          </span>
          <span>Active {formatAge(board.lastActivityAt)}</span>
          {board.totalBytes > 0 ? (
            <span>{formatBytes(board.totalBytes)}</span>
          ) : null}
          {board.openThreadCount > 0 ? (
            <span>
              {board.openThreadCount} open{" "}
              {board.openThreadCount === 1 ? "thread" : "threads"}
              {board.unhandledCount > 0
                ? `, ${String(board.unhandledCount)} unanswered`
                : ""}
            </span>
          ) : null}
          {expiry === null ? (
            <span className="ar-tag" data-tone="kept">
              Kept
            </span>
          ) : (
            <span
              className="ar-tag"
              data-tone={expiry.amber ? "amber" : "quiet"}
              data-testid="expiry"
            >
              {expiry.text}
            </span>
          )}
        </span>
      </Link>
      <div className="ar-row-actions">
        {archived ? null : (
          <button
            type="button"
            className="ui-btn"
            aria-pressed={board.keep}
            disabled={keep.isPending}
            onClick={() => {
              keep.mutate({ slug: board.slug, keep: !board.keep });
            }}
          >
            <PinIcon aria-hidden="true" />
            {board.keep ? "Kept" : "Keep"}
          </button>
        )}
        {archived ? (
          <button
            type="button"
            className="ui-btn"
            disabled={archive.isPending}
            onClick={() => {
              archive.mutate({ slug: board.slug, archived: false });
            }}
          >
            <ArchiveRestoreIcon aria-hidden="true" />
            Restore
          </button>
        ) : (
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              onArchive(board);
            }}
          >
            <ArchiveIcon aria-hidden="true" />
            Archive
          </button>
        )}
      </div>
    </li>
  );
}

export function InboxPage(): React.JSX.Element {
  useLiveUpdates();
  const inbox = useInbox();
  const archive = useArchive();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.find((candidate) => candidate === requested) ?? "review";
  const [confirm, setConfirm] = useState<InboxBoard | null>(null);

  const boards = inbox.data?.boards ?? [];
  const sorted = [...boards].sort(
    (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
  );
  const shown = sorted.filter((board) => inTab(board, tab));
  const count = (candidate: InboxTab): number =>
    sorted.filter((board) => inTab(board, candidate)).length;

  return (
    <main className="ar-page" id="content" tabIndex={-1}>
      <title>Inbox · Artifacts</title>
      <div className="ar-page-head">
        <h1>Inbox</h1>
        <Tabs
          label="Show"
          value={tab}
          onChange={(next) => {
            setParams(next === "review" ? {} : { tab: next }, {
              replace: true,
            });
          }}
          options={[
            { value: "review", label: "Needs review", count: count("review") },
            { value: "active", label: "Active", count: count("active") },
            { value: "kept", label: "Kept", count: count("kept") },
            { value: "archived", label: "Archived", count: count("archived") },
          ]}
        />
      </div>
      {inbox.isPending ? (
        <p className="ar-empty" role="status">
          Loading…
        </p>
      ) : inbox.isError ? (
        <p className="ar-empty" role="alert">
          Could not load the inbox: {inbox.error.message}
        </p>
      ) : shown.length === 0 ? (
        <p className="ar-empty">{EMPTY[tab]}</p>
      ) : (
        <ul className="ar-rows" aria-label="Boards">
          {shown.map((board) => (
            <Row key={board.id} board={board} onArchive={setConfirm} />
          ))}
        </ul>
      )}
      <Dialog
        open={confirm !== null}
        title={`Archive “${confirm?.title ?? ""}”?`}
        onClose={() => {
          setConfirm(null);
        }}
      >
        <p>
          Its files are deleted 7 days after you archive it. Threads stay. You
          can restore it until then.
        </p>
        <div className="ar-dialog-actions">
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              setConfirm(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn"
            data-variant="primary"
            onClick={() => {
              if (confirm !== null)
                archive.mutate({ slug: confirm.slug, archived: true });
              setConfirm(null);
            }}
          >
            Archive board
          </button>
        </div>
      </Dialog>
    </main>
  );
}
