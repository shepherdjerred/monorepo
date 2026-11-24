import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CompassIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { ErrorNotice } from "#client/components.tsx";
import { readMovieRequests } from "#client/movie-editions/requests.tsx";
import { MovieRequestSubject } from "#client/movie-editions/subject.tsx";
import { useImportedRequests } from "#client/personal-migration/source.tsx";
import { ListedTargets } from "#client/target-controls/listed.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import styles from "./library.module.css";
import { mineTitles } from "./mine-model.ts";
import { MineTitleEntry } from "./mine-title.tsx";
import { PlexRequestHistory } from "./plex-request-history.tsx";
import { interestsRead, REQUESTS_READ } from "./reads.ts";
import { SeerrRequestHistory } from "./seerr-request-history.tsx";

const cx = classNames(styles);

export function LibraryMine({ user }: { user: MediaUser }) {
  return (
    <>
      <MineRequests user={user} />
      <SeerrRequestHistory userId={user.id} />
      <PlexRequestHistory key={user.id} userId={user.id} />
    </>
  );
}

/**
 * Everything the reader asked for, one entry per film or series: how far
 * along it is, whether they still follow it, any "still watching?" check
 * waiting on them, and every control each request has.
 *
 * Three reads know parts of this, and they are joined by request id, so the
 * two paged ones are read to the end before anything is shown.
 */
function MineRequests({ user }: { user: MediaUser }) {
  // The owner can look at a managed profile's film requests instead of
  // their own; everyone else's subject is themselves.
  const [subjectUserId, setSubjectUserId] = useState(user.id);
  const [params] = useSearchParams();
  const linkedRequestId = params.get("interest");
  const requests = useQuery({ ...REQUESTS_READ, refetchInterval: 15_000 });
  const interests = useCursorList(interestsRead(user.id));
  const movies = useCursorList({
    queryKey: ["movie-requests", 4, subjectUserId],
    read: (cursor) => readMovieRequests(subjectUserId, cursor),
    paging: "all",
    refetchInterval: 15_000,
  });
  const imported = useImportedRequests(user.id);
  const error = requests.error ?? interests.error ?? movies.error;
  const subject = (
    <div className={cx("subject")}>
      <MovieRequestSubject
        user={user}
        subjectUserId={subjectUserId}
        change={setSubjectUserId}
        label="Show film requests of"
      />
    </div>
  );
  if (error !== null) {
    return (
      <ErrorState
        error={error}
        what="What you asked for"
        onRetry={() => {
          void requests.refetch();
          interests.retry();
          movies.retry();
        }}
      />
    );
  }
  if (
    requests.data === undefined ||
    interests.pending ||
    movies.pending ||
    // Another profile's film requests must never sit under this one's name.
    movies.stale
  ) {
    return (
      <>
        {subject}
        <RowsSkeleton label="Loading what you asked for" />
      </>
    );
  }
  const titles = mineTitles({
    requests: requests.data,
    interests: interests.items,
    movieRequests: movies.items,
    movieSubjectId: subjectUserId,
    imported: imported.data ?? [],
  });
  if (titles.length === 0) {
    return (
      <>
        {subject}
        <EmptyState
          icon={CompassIcon}
          title="No current requests"
          action={
            <Link className="button primary" to="/discover">
              Find something to watch
            </Link>
          }
        >
          Films and series you ask for show here, with how far along they are
          and whether you still follow them.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {subject}
      {imported.error !== null && <ErrorNotice error={imported.error} />}
      {user.role === "owner" && (
        <p className={cx("intro")}>
          As the library owner you also see what everyone else in the household
          asked for.
        </p>
      )}
      <ListedTargets
        mediaIds={titles.flatMap((title) =>
          title.asks.flatMap((ask) =>
            ask.movie === null &&
            ask.request !== null &&
            ask.request.media.kind !== "movie"
              ? [ask.request.mediaId]
              : [],
          ),
        )}
      >
        <ul className={cx("entries")} aria-label="What you asked for">
          {titles.map((title) => (
            <MineTitleEntry
              key={title.rootMediaId}
              user={user}
              title={title}
              subjectUserId={subjectUserId}
              linkedRequestId={linkedRequestId}
            />
          ))}
        </ul>
      </ListedTargets>
    </>
  );
}
