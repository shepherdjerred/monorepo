import { useInfiniteQuery } from "@tanstack/react-query";
import { readApi } from "#client/api.ts";
import {
  dateLabel,
  EmptyState,
  ErrorNotice,
  Loading,
} from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import {
  LegacyActivityPageSchema,
  legacyActivitySourceLabel,
  type LegacyActivityEvent,
  type LegacyActivityQuery,
} from "#shared/legacy-activity/contract.ts";
import styles from "./activity.module.css";

const cx = classNames(styles);
const managerActions = {
  grabbed: "Release grabbed",
  downloadFailed: "Download failed",
  downloadFolderImported: "Download imported",
  downloadIgnored: "Download ignored",
  episodeFileDeleted: "Episode file deleted",
  episodeFileRenamed: "Episode file renamed",
  movieFileDeleted: "Movie file deleted",
  movieFileRenamed: "Movie file renamed",
  movieFolderImported: "Movie imported",
} satisfies Record<Exclude<LegacyActivityEvent["action"], number>, string>;

function actionLabel(event: LegacyActivityEvent): string {
  if (event.source !== "bazarr") return managerActions[event.action];
  switch (event.action) {
    case 0:
      return "Subtitle deleted";
    case 1:
      return "Subtitle downloaded";
    case 2:
      return "Subtitle manually downloaded";
    case 3:
      return "Subtitle upgraded";
    case 4:
      return "Subtitle uploaded";
    case 5:
      return "Subtitle synchronized";
    default:
      return `Subtitle history action ${String(event.action)}`;
  }
}

function reference(kind: string, id: number | null): string | null {
  return id === null || id === 0 ? null : `${kind} #${String(id)}`;
}

function references(event: LegacyActivityEvent): string[] {
  switch (event.source) {
    case "sonarr":
      return [
        reference("Series", event.seriesId),
        reference("Episode", event.episodeId),
      ].filter((value) => value !== null);
    case "radarr":
      return [reference("Movie", event.movieId)].filter(
        (value) => value !== null,
      );
    case "bazarr":
      return [
        reference("Series", event.seriesId),
        reference(event.table === "movie" ? "Movie" : "Episode", event.mediaId),
      ].filter((value) => value !== null);
  }
}

export function ImportedActivity({
  source,
}: {
  source: LegacyActivityQuery["source"];
}) {
  const activity = useInfiniteQuery({
    queryKey: ["activity", source],
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ source });
      if (pageParam !== "") query.set("before", pageParam);
      return readApi(`/activity?${query.toString()}`, LegacyActivityPageSchema);
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = activity.data?.pages.flatMap((page) => page.items);
  return (
    <>
      {activity.isPending && <Loading />}
      {activity.error !== null && <ErrorNotice error={activity.error} />}
      {items?.length === 0 && (
        <EmptyState title="No imported activity">
          Archived activity from Sonarr, Radarr, and Bazarr appears here after
          import.
        </EmptyState>
      )}
      <ol className={cx("list")} aria-label="Imported library activity">
        {items?.map(({ id, event }) => (
          <li className={cx("timelineItem")} key={id}>
            <span className={cx("timelineDot")} aria-hidden="true" />
            <div className={cx("itemMain")}>
              <h2>{actionLabel(event)}</h2>
              <p>
                {legacyActivitySourceLabel[event.source]} ·{" "}
                <time dateTime={event.sourceDate}>
                  {dateLabel(event.sourceDate)}
                </time>
              </p>
              <p>
                {[
                  ...references(event),
                  event.source === "bazarr" ? event.language : null,
                  event.provider,
                  `Event #${String(event.originalId)}`,
                ]
                  .filter((value) => value !== null)
                  .join(" · ")}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {activity.hasNextPage && (
        <button
          className="button"
          type="button"
          disabled={activity.isFetchingNextPage}
          onClick={() => {
            void activity.fetchNextPage();
          }}
        >
          {activity.isFetchingNextPage
            ? "Loading activity…"
            : "Load older activity"}
        </button>
      )}
    </>
  );
}
