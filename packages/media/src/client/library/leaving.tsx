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
  type KeepCandidate,
  type KeepOutcome,
  type KeepOutcomes,
} from "./keep-all.ts";
import {
  entryRows,
  entrySingleRow,
  entryTargetIds,
  entryTitle,
  leavingEntries,
  runDismissed,
  runFinished,
  runReported,
  runStarted,
  unkeptRows,
  type EntryRow,
  type KeepRuns,
  type LeavingEntry,
} from "./keep-run.ts";
import styles from "./library.module.css";
import {
  leavingTitles,
  useRemovals,
  type LeavingRow,
  type LeavingTitle,
} from "./removals.ts";

const cx = classNames(styles);

const NO_OUTCOMES: KeepOutcomes = new Map();

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
  shown,
  outcome,
}: {
  user: MediaUser;
  shown: EntryRow;
  outcome: KeepOutcome | undefined;
}) {
  if (outcome === undefined) {
    // A row a run never reached, or one that started leaving since.
    return shown.listed ? (
      <ListedMediaAction
        user={user}
        mediaId={shown.row.removal.mediaId}
        action="keep"
      />
    ) : (
      <p className={cx("partNote")}>No longer leaving</p>
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
 *
 * Once that action has run, everything here is about the rows it started
 * with (`entry.run`), not the rows the list holds now: the list drops each
 * kept row when it is read again, and the report must not shrink with it.
 */
function Parts({
  user,
  name,
  entry,
  onKeepAll,
  onDismiss,
}: {
  user: MediaUser;
  name: string;
  entry: LeavingEntry;
  onKeepAll: (candidates: readonly KeepCandidate[]) => void;
  onDismiss: () => void;
}) {
  const { run } = entry;
  // What "all" means: the run's rows once there is a run, the list's before.
  const subject = run?.title.rows ?? entry.current?.rows ?? [];
  const outcomes = run?.outcomes ?? NO_OUTCOMES;
  const unkept = run === null ? subject : unkeptRows(run);
  const views = useListedTargetViews(unkept.map((row) => row.removal.mediaId));
  const candidates = views.flatMap(({ mediaId, data, error }) => {
    const view = error ?? data;
    return view === undefined ? [] : [{ mediaId, view }];
  });
  const total = subject.length;
  const parts = noun(subject);
  const running = run?.running === true;
  const failed = [...outcomes.values()].some(
    (outcome) => outcome.status === "failed",
  );
  const settled = [...outcomes.values()].filter(
    (outcome) => outcome.status !== "saving",
  ).length;
  const summary = keepSummary(outcomes, total, parts);
  return (
    <div className={cx("parts")}>
      {unkept.length > 0 && (
        <button
          className="button primary"
          type="button"
          disabled={running || candidates.length < unkept.length}
          onClick={() => {
            onKeepAll(candidates);
          }}
        >
          {running
            ? `Keeping ${String(Math.min(settled + 1, total))} of ${String(total)}…`
            : failed
              ? `Try the ${String(unkept.length)} that failed again`
              : `Keep all ${String(total)} ${parts}`}
        </button>
      )}
      <p className={cx("partsSummary")} role="status">
        {summary}
      </p>
      {run !== null && !running && summary !== null && (
        <button className="button subtle" type="button" onClick={onDismiss}>
          Dismiss this report
        </button>
      )}
      <details className={cx("partsList")} open={failed ? true : undefined}>
        <summary>
          {run === null
            ? `${String(total)} ${parts} of ${name} leaving`
            : `The ${String(total)} ${parts} of ${name} in this report`}
        </summary>
        <ul>
          {entryRows(entry).map((shown) => (
            <li className={cx("part")} key={shown.row.removal.id}>
              <div>
                <p className={cx("partName")}>
                  {shown.row.removal.media.title}
                </p>
                <p className={cx("rowDetail")}>{leaves(shown.row)}</p>
              </div>
              <RowOutcome
                user={user}
                shown={shown}
                outcome={outcomes.get(shown.row.removal.mediaId)}
              />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Whether anything of the title already has a date to leave by. */
export function leavingPhase(title: LeavingTitle) {
  return title.rows.some((row) => row.phase === "grace_period")
    ? "grace_period"
    : "warning_pending";
}

type KeepAll = (
  title: LeavingTitle,
  candidates: readonly KeepCandidate[],
) => void;

export type KeepRunControls = {
  runs: KeepRuns;
  keepAll: KeepAll;
  dismiss: (rootMediaId: string) => void;
};

/**
 * The "keep all" runs of a list of leaving titles, and how to start one, try
 * its failures again, and dismiss its report. Held by whatever holds the
 * list: a report must outlive the rows it is about.
 */
export function useKeepRuns(user: MediaUser): KeepRunControls {
  const [runs, setRuns] = useState<KeepRuns>(new Map());

  async function keepAll(
    title: LeavingTitle,
    candidates: readonly KeepCandidate[],
  ) {
    const root = title.rootMediaId;
    const started = runStarted(runs, title);
    setRuns((current) => runStarted(current, title));
    await keepEach({
      candidates,
      previous: started.get(root)?.outcomes ?? NO_OUTCOMES,
      write: (submission) =>
        writeTarget(user.id, submission.context, submission.command),
      report: (mediaId, outcome) => {
        setRuns((current) => runReported(current, root, { mediaId, outcome }));
      },
    });
    setRuns((current) => runFinished(current, root));
    // One refresh for the whole run: kept parts leave the list together.
    await Promise.all(
      ["targets", "target", "removals", "library", "requests", "activity"].map(
        (key) => queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }

  return {
    runs,
    keepAll: (title, candidates) => {
      void keepAll(title, candidates);
    },
    dismiss: (rootMediaId) => {
      setRuns((current) => runDismissed(current, rootMediaId));
    },
  };
}

/**
 * The one thing to do about an entry: keep it for 30 days, or, when several
 * parts of it are leaving or a run has a report on it, keep them all.
 */
export function LeavingKeep({
  user,
  entry,
  onKeepAll,
  onDismiss,
}: {
  user: MediaUser;
  entry: LeavingEntry;
  onKeepAll: KeepAll;
  onDismiss: () => void;
}) {
  const title = entryTitle(entry);
  const single = entrySingleRow(entry);
  return single === undefined ? (
    <Parts
      user={user}
      name={title.name}
      entry={entry}
      onKeepAll={(candidates) => {
        // A retry is of the run's own title, not of today's list.
        onKeepAll(entry.run?.title ?? title, candidates);
      }}
      onDismiss={onDismiss}
    />
  ) : (
    <ListedMediaAction
      user={user}
      mediaId={single.removal.mediaId}
      action="keep"
    />
  );
}

function Entry({
  user,
  entry,
  onKeepAll,
  onDismiss,
}: {
  user: MediaUser;
  entry: LeavingEntry;
  onKeepAll: KeepAll;
  onDismiss: () => void;
}) {
  const { current } = entry;
  // An entry is a title that is leaving, a run's report, or both.
  const title = entryTitle(entry);
  // Without a report, one row is just that row and its own hold.
  const single = entrySingleRow(entry);
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
        {current === null ? (
          <p className={cx("rowDetail")}>None of it is leaving any more.</p>
        ) : (
          <p className={cx("entryState")}>
            <StatePill
              state={{
                label: LEAVING_COPY[leavingPhase(current)](current.leavesAt),
                tone: "warn",
              }}
            />
          </p>
        )}
        {current !== null && current.leavesAt === null && (
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
        <LeavingKeep
          user={user}
          entry={entry}
          onKeepAll={onKeepAll}
          onDismiss={onDismiss}
        />
      </div>
    </li>
  );
}

/** What is about to leave the library, for the whole household to see. */
export function LibraryLeaving({ user }: { user: MediaUser }) {
  const removals = useRemovals();
  // Held here, above the list: a report must outlive the rows it is about.
  const keep = useKeepRuns(user);
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
  const entries = leavingEntries(titles, keep.runs);
  if (entries.length === 0) {
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
      <ListedTargets mediaIds={entryTargetIds(entries)}>
        <ul className={cx("entries")} aria-label="Leaving soon">
          {entries.map((entry) => (
            <Entry
              key={entry.rootMediaId}
              user={user}
              entry={entry}
              onKeepAll={keep.keepAll}
              onDismiss={() => {
                keep.dismiss(entry.rootMediaId);
              }}
            />
          ))}
        </ul>
      </ListedTargets>
    </>
  );
}
