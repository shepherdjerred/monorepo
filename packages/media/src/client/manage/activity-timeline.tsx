import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { readApi } from "#client/api.ts";
import { OperationListSchema, type OperationList } from "#shared/api.ts";
import {
  dateLabel,
  EmptyState,
  ErrorNotice,
  humanize,
  Loading,
  Status,
} from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import {
  LegacyActivityPageSchema,
  legacyActivitySourceLabel,
  type LegacyActivityEvent,
  type LegacyActivityPage,
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

type TimelineRow =
  | {
      kind: "native";
      date: string;
      id: string;
      operation: OperationList[number];
    }
  | {
      kind: "imported";
      date: string;
      id: string;
      item: LegacyActivityPage["items"][number];
    };

function TimelineEvent({ row }: { row: TimelineRow }) {
  if (row.kind === "native") {
    const { operation } = row;
    return (
      <>
        <div className={cx("itemMain")}>
          <h2>{humanize(operation.kind)}</h2>
          <p>
            Media · <time dateTime={row.date}>{dateLabel(row.date)}</time>
          </p>
          {operation.mediaId !== null && (
            <Link
              className="text-link"
              to={`/media/${encodeURIComponent(operation.mediaId)}`}
            >
              View title →
            </Link>
          )}
        </div>
        <Status value={operation.status} />
      </>
    );
  }
  const { event, media } = row.item;
  return (
    <div className={cx("itemMain")}>
      <h2>{actionLabel(event)}</h2>
      <p>
        {legacyActivitySourceLabel[event.source]} ·{" "}
        <time dateTime={row.date}>{dateLabel(row.date)}</time>
      </p>
      {media !== undefined && (
        <Link
          className="text-link"
          to={`/media/${encodeURIComponent(media.id)}`}
        >
          {media.title}
        </Link>
      )}
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
  );
}

function chronologicalRows(
  operations: OperationList,
  items: LegacyActivityPage["items"],
) {
  const rows: TimelineRow[] = [
    ...operations.map((operation): TimelineRow => ({
      kind: "native",
      id: operation.id,
      date: operation.updatedAt,
      operation,
    })),
    ...items.map((item): TimelineRow => ({
      kind: "imported",
      id: item.id,
      date: item.event.sourceDate,
      item,
    })),
  ];
  return rows.sort(
    (left, right) =>
      Date.parse(right.date) - Date.parse(left.date) ||
      left.id.localeCompare(right.id),
  );
}

function TimelineFeedback({
  loading,
  mediaError,
  importError,
  empty,
  showMedia,
}: {
  loading: boolean;
  mediaError: Error | null;
  importError: Error | null;
  empty: boolean;
  showMedia: boolean;
}) {
  if (loading) return <Loading />;
  if (mediaError !== null) return <ErrorNotice error={mediaError} />;
  if (importError !== null) return <ErrorNotice error={importError} />;
  if (!empty) return null;
  return (
    <EmptyState title={showMedia ? "All quiet here" : "No imported activity"}>
      {showMedia
        ? "New requests, upgrades, and library changes will appear here."
        : "Archived activity from Sonarr, Radarr, and Bazarr appears here after import."}
    </EmptyState>
  );
}

export function ActivityTimeline({
  source,
}: {
  source: "all" | "media" | LegacyActivityQuery["source"];
}) {
  const showMedia = source === "all" || source === "media";
  const showImported = source !== "media";
  const importedSource = showMedia ? "imported" : source;
  const media = useQuery({
    queryKey: ["activity"],
    queryFn: async () => readApi("/activity", OperationListSchema),
    refetchInterval: 10_000,
    enabled: showMedia,
  });
  const imported = useInfiniteQuery({
    queryKey: ["activity", importedSource],
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ source: importedSource });
      if (pageParam !== "") query.set("before", pageParam);
      return readApi(`/activity?${query.toString()}`, LegacyActivityPageSchema);
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: showImported,
  });
  const rows = chronologicalRows(
    (showMedia ? media.data : undefined) ?? [],
    (showImported
      ? imported.data?.pages.flatMap((page) => page.items)
      : undefined) ?? [],
  );
  const loading =
    (showMedia && media.isPending) || (showImported && imported.isPending);
  const mediaError = showMedia ? media.error : null;
  const importError = showImported ? imported.error : null;
  return (
    <>
      <TimelineFeedback
        loading={loading}
        mediaError={mediaError}
        importError={importError}
        empty={rows.length === 0}
        showMedia={showMedia}
      />
      <ol className={cx("list")} aria-label="Library activity">
        {rows.map((row) => (
          <li className={cx("timelineItem")} key={row.id}>
            <span className={cx("timelineDot")} aria-hidden="true" />
            <TimelineEvent row={row} />
          </li>
        ))}
      </ol>
      {showImported && imported.hasNextPage && (
        <button
          className="button"
          type="button"
          disabled={imported.isFetchingNextPage}
          onClick={() => {
            void imported.fetchNextPage();
          }}
        >
          {imported.isFetchingNextPage
            ? "Loading activity…"
            : "Load older activity"}
        </button>
      )}
    </>
  );
}
