import { useState } from "react";
import { HourglassIcon } from "lucide-react";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient } from "#client/api.ts";
import { LEAVING_COPY, shortDate } from "#client/presentation/state-phrase.ts";
import { writeTarget } from "#client/target-controls/api.ts";
import {
  ListedTargets,
  useListedTargetViews,
} from "#client/target-controls/listed.tsx";
import { ListedMediaAction } from "#client/target-controls/protection.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { StatePill } from "#client/ui/poster-card.tsx";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import {
  keepEach,
  keepSummary,
  remaining,
  type KeepOutcome,
  type KeepOutcomes,
} from "./keep-all.ts";
import styles from "./library.module.css";
import {
  leavingTitles,
  useRemovals,
  type LeavingRow,
  type LeavingTitle,
} from "./removals.ts";

const cx = classNames(styles);

/** What the rows of a title are, for "Keep all 8 episodes". */
function noun(rows: readonly LeavingRow[]): string {
  const kinds = new Set(rows.map((row) => row.removal.media.kind));
  if (kinds.size === 1 && kinds.has("episode")) return "episodes";
  return kinds.size === 1 && kinds.has("season") ? "seasons" : "items";
}

function leaves(row: LeavingRow): string {
  return row.removal.graceUntil === null
    ? "No date set yet"
    : `Leaves ${shortDate(row.removal.graceUntil)}`;
}

function RowOutcome({
  user,
  row,
  outcome,
}: {
  user: MediaUser;
  row: LeavingRow;
  outcome: KeepOutcome | undefined;
}) {
  if (outcome === undefined) {
    return (
      <ListedMediaAction
        user={user}
        mediaId={row.removal.mediaId}
        action="keep"
      />
    );
  }
  if (outcome.status === "saving") {
    return <p className={cx("partNote")}>Keeping…</p>;
  }
  if (outcome.status === "kept") {
    return (
      <p className={cx("partNote")} data-tone="ok">
        Kept for 30 days
      </p>
    );
  }
  return (
    <p className={cx("partNote")} data-tone="danger">
      Not kept: {outcome.error.message}
    </p>
  );
}

/**
 * Several parts of one series leaving together: one action keeps them all,
 * by sending each part's own keep command in turn, and each part can still be
 * kept on its own.
 */
function Parts({ user, title }: { user: MediaUser; title: LeavingTitle }) {
  const views = useListedTargetViews(
    title.rows.map((row) => row.removal.mediaId),
  );
  const [outcomes, setOutcomes] = useState<KeepOutcomes>(new Map());
  const [running, setRunning] = useState(false);
  const parts = noun(title.rows);
  const candidates = views.flatMap(({ mediaId, data, error }) => {
    const view = error ?? data;
    return view === undefined ? [] : [{ mediaId, view }];
  });
  const loaded = candidates.length === title.rows.length;
  const todo = remaining(candidates, outcomes);
  const done = [...outcomes.values()].filter(
    (outcome) => outcome.status !== "saving",
  ).length;
  const failed = [...outcomes.values()].some(
    (outcome) => outcome.status === "failed",
  );
  const summary = keepSummary(outcomes, title.rows.length, parts);

  async function keepAll() {
    setRunning(true);
    await keepEach({
      candidates,
      previous: outcomes,
      write: (submission) =>
        writeTarget(user.id, submission.context, submission.command),
      report: (mediaId, outcome) => {
        setOutcomes((current) => new Map(current).set(mediaId, outcome));
      },
    });
    setRunning(false);
    // One refresh for the whole run: kept parts leave the list together.
    await Promise.all(
      ["targets", "target", "removals", "library", "requests", "activity"].map(
        (key) => queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }

  return (
    <div className={cx("parts")}>
      {todo.length > 0 && (
        <button
          className="button primary"
          type="button"
          disabled={running || !loaded}
          onClick={() => {
            void keepAll();
          }}
        >
          {running
            ? `Keeping ${String(Math.min(done + 1, title.rows.length))} of ${String(title.rows.length)}…`
            : failed
              ? `Try the ${String(todo.length)} that failed again`
              : `Keep all ${String(title.rows.length)} ${parts}`}
        </button>
      )}
      <p className={cx("partsSummary")} role="status">
        {summary}
      </p>
      <details className={cx("partsList")} open={failed ? true : undefined}>
        <summary>
          {`${String(title.rows.length)} ${parts} of ${title.name} leaving`}
        </summary>
        <ul>
          {title.rows.map((row) => (
            <li className={cx("part")} key={row.removal.id}>
              <div>
                <p className={cx("partName")}>{row.removal.media.title}</p>
                <p className={cx("rowDetail")}>{leaves(row)}</p>
              </div>
              <RowOutcome
                user={user}
                row={row}
                outcome={outcomes.get(row.removal.mediaId)}
              />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Title({ user, title }: { user: MediaUser; title: LeavingTitle }) {
  const [only] = title.rows;
  const single = title.rows.length === 1 ? only : undefined;
  const phase = title.rows.some((row) => row.phase === "grace_period")
    ? "grace_period"
    : "warning_pending";
  return (
    <li className={cx("entry")}>
      <div className={cx("entryPoster")}>
        <Poster path={title.posterPath} title={title.name} sizes="72px" />
      </div>
      <div className={cx("entryBody")}>
        <h2 className={cx("entryTitle")}>
          <Link to={`/media/${encodeURIComponent(title.rootMediaId)}`}>
            {title.name}
          </Link>
        </h2>
        <p className={cx("entryState")}>
          <StatePill
            state={{
              label: LEAVING_COPY[phase](title.leavesAt),
              tone: "warn",
            }}
          />
        </p>
        {title.leavesAt === null && (
          <p className={cx("rowDetail")}>
            The people who asked for it are being told first. It gets a date
            once they have been.
          </p>
        )}
        {single !== undefined && !single.whole && (
          <p className={cx("rowDetail")}>{single.removal.media.title}</p>
        )}
      </div>
      <div className={cx("entryAction")}>
        {single === undefined ? (
          <Parts user={user} title={title} />
        ) : (
          <ListedMediaAction
            user={user}
            mediaId={single.removal.mediaId}
            action="keep"
          />
        )}
      </div>
    </li>
  );
}

/** What is about to leave the library, for the whole household to see. */
export function LibraryLeaving({ user }: { user: MediaUser }) {
  const removals = useRemovals();
  if (removals.error !== null) {
    return (
      <ErrorState
        error={removals.error}
        what="What is leaving"
        onRetry={() => {
          void removals.refetch();
        }}
      />
    );
  }
  if (removals.data === undefined) {
    return <RowsSkeleton label="Loading what is leaving" />;
  }
  const titles = leavingTitles(removals.data);
  if (titles.length === 0) {
    return (
      <EmptyState icon={HourglassIcon} title="Nothing is leaving">
        A film or series shows here before it leaves the library, with time to
        keep it.
      </EmptyState>
    );
  }
  return (
    <>
      <p className={cx("intro")}>
        These leave when nobody follows them and they are not kept for good.
        Anyone in the household can keep one for another 30 days. After
        something leaves, its files can still be restored for a week; that is
        under Removed.
      </p>
      <ListedTargets
        mediaIds={titles.flatMap((title) =>
          title.rows.map((row) => row.removal.mediaId),
        )}
      >
        <ul className={cx("entries")} aria-label="Leaving soon">
          {titles.map((title) => (
            <Title key={title.rootMediaId} user={user} title={title} />
          ))}
        </ul>
      </ListedTargets>
    </>
  );
}
