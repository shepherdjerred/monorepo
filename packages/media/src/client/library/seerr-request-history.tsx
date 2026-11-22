import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { ImportedRequestHistorySchema } from "#shared/personal-migration/history.ts";
import { readApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { ErrorState } from "#client/ui/states.tsx";
import styles from "./library.module.css";

const cx = classNames(styles);

type Request = z.output<typeof ImportedRequestHistorySchema>[number];

const sourceNames = {
  seerr: "Seerr",
  overseerr: "Overseerr",
  jellyseerr: "Jellyseerr",
} as const;

const scopeNames = {
  movie: "Film",
  series: "Whole series",
  season: "Season request",
  episode: "Episode request",
} as const;

const statuses = new Map([
  [1, "Pending"],
  [2, "Approved"],
  [3, "Declined"],
  [4, "Failed"],
  [5, "Fulfilled"],
]);

function requestScope(request: Request) {
  if (request.seasonNumbers.length === 0) return scopeNames[request.scope];
  const numbers = request.seasonNumbers.join(", ");
  const seasons = request.seasonNumbers.length === 1 ? "Season" : "Seasons";
  const label = `${seasons} ${numbers}`;
  return request.scope === "episode" ? `Episode request · ${label}` : label;
}

function statusLabel(status: Request["sourceStatus"]) {
  if (status === null) return "Status unavailable";
  const label = statuses.get(status);
  if (label === undefined) throw new Error("Unknown imported request status");
  return label;
}

function RequestHistoryRow({ request }: { request: Request }) {
  const title =
    request.title ??
    (request.scope === "movie"
      ? "Film title unavailable"
      : "Series title unavailable");
  return (
    <li className={cx("requestHistoryRow")}>
      <div>
        <p className={cx("entryTitle")}>{title}</p>
        <p className={cx("rowDetail")}>{requestScope(request)}</p>
      </div>
      <div className={cx("requestHistoryWhen")}>
        {request.requestedAt === null ? (
          "Request date unavailable"
        ) : (
          <time dateTime={request.requestedAt}>
            {dateLabel(request.requestedAt)}
          </time>
        )}
        <p className={cx("rowDetail")}>
          {sourceNames[request.sourceKind]} ·{" "}
          {statusLabel(request.sourceStatus)}
        </p>
      </div>
    </li>
  );
}

/** Read-only imported request history visible to the signed-in person. */
export function SeerrRequestHistory({ userId }: { userId: string }) {
  const heading = useId();
  const history = useQuery({
    queryKey: ["seerr-request-history", userId],
    queryFn: () =>
      readApi("/requests/imported-history", ImportedRequestHistorySchema),
  });
  if (history.error === null && history.data?.length === 0) return null;

  return (
    <section className={cx("requestHistory")}>
      <h2 id={heading}>Past Seerr requests</h2>
      {history.isPending && (
        <RowsSkeleton label="Loading past Seerr requests" />
      )}
      {history.data !== undefined && history.data.length > 0 && (
        <ol className={cx("entries")} role="list" aria-labelledby={heading}>
          {history.data.map((request) => (
            <RequestHistoryRow key={request.id} request={request} />
          ))}
        </ol>
      )}
      {history.error !== null && (
        <ErrorState
          error={history.error}
          what="Past Seerr requests"
          headingLevel={3}
          onRetry={() => void history.refetch()}
        />
      )}
    </section>
  );
}
