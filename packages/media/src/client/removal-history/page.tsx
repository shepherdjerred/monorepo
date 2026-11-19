import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { RemovalHistoryPageSchema } from "#shared/household/calendar.ts";
import { readApi } from "#client/api.ts";
import {
  dateLabel,
  EmptyState,
  ErrorNotice,
  humanize,
  Loading,
  MediaLink,
  PageTitle,
  Status,
} from "#client/components.tsx";
import "#client/calendar/style.css";
import { firstListCursor } from "#client/household/list-cursor.ts";

export function RemovalHistoryPage({ user }: { user: MediaUser }) {
  const history = useInfiniteQuery({
    queryKey: ["removal-history"],
    initialPageParam: firstListCursor(),
    queryFn: ({ pageParam }) =>
      readApi(
        `/removal-history${pageParam === null ? "" : `?cursor=${encodeURIComponent(pageParam)}`}`,
        RemovalHistoryPageSchema,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <PageTitle
        eyebrow={
          user.role === "owner"
            ? "Household library history"
            : "Your request history"
        }
        title="Removed titles"
      >
        <p>
          What Media removed, why it left, and whether it can still be restored.
          The record stays after the files are purged.
        </p>
      </PageTitle>
      {history.isPending && <Loading />}
      {history.error !== null && <ErrorNotice error={history.error} />}
      {!history.isPending && items.length === 0 && (
        <EmptyState title="No completed removals">
          Titles will appear here after Media moves their files out of the
          library.
        </EmptyState>
      )}
      <div className="item-list">
        {items.map((item) => (
          <article className="panel" key={item.id}>
            <MediaLink
              id={item.mediaId}
              title={
                item.seriesTitle === null
                  ? item.title
                  : `${item.seriesTitle}: ${item.title}`
              }
            />
            <p>
              {humanize(item.kind)} · {item.edition} edition
              {item.seasonNumber === null || item.episodeNumber === null
                ? ""
                : ` · S${String(item.seasonNumber)} E${String(item.episodeNumber)}`}
            </p>
            <Status value={item.state} />
            <p>
              {item.reason === "owner_removed"
                ? "Removed by the library owner."
                : item.reason === "temporary_interest_released"
                  ? "All temporary interest ended and the title had no permanent Keep."
                  : "Completed by its requesters under the library's removal policy."}
            </p>
            {item.requesterContext === "your_request" && (
              <p className="muted">This title was part of your requests.</p>
            )}
            <dl className="removal-history-dates">
              <dt>Quarantined</dt>
              <dd>{dateLabel(item.quarantinedAt)}</dd>
              <dt>Purged</dt>
              <dd>
                {item.purgedAt === null
                  ? item.state === "purged"
                    ? "Completed; exact date not recorded"
                    : "Not purged"
                  : dateLabel(item.purgedAt)}
              </dd>
              <dt>Restore deadline</dt>
              <dd>{dateLabel(item.restoreDeadline)}</dd>
            </dl>
            <p>
              {item.restoreState === "recoverable"
                ? "Files are in recoverable quarantine."
                : item.restoreState === "restored"
                  ? "The quarantined files were restored."
                  : item.restoreState === "reacquire"
                    ? "Files were purged. A new request will search for them again."
                    : "Review the title for its current recovery options."}
            </p>
            <Link
              className="button subtle"
              to={`/media/${encodeURIComponent(item.mediaId)}`}
            >
              {item.restoreState === "reacquire"
                ? "Request again"
                : "View title and recovery"}
            </Link>
          </article>
        ))}
      </div>
      {history.hasNextPage && (
        <button
          className="button"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            void history.fetchNextPage();
          }}
        >
          Load older removals
        </button>
      )}
    </>
  );
}
