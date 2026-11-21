import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { PlaybackStatisticsSchema } from "#shared/household/playback.ts";
import { readApi } from "#client/api.ts";
import { PLAYBACK_DECISION_COPY } from "#client/presentation/playback.ts";
import { classNames } from "#client/ui/class-names.ts";
import { SkeletonStatus } from "#client/ui/skeleton.tsx";
import skeletonStyles from "#client/ui/skeleton.module.css";
import { ErrorState } from "#client/ui/states.tsx";
import {
  barScale,
  playCount,
  share,
  watchTime,
  wholeNumber,
} from "./format.ts";
import styles from "./history.module.css";
import { filterKey, statisticsReadPath, type HistoryView } from "./view.ts";

const cx = classNames(styles);
const block = classNames(skeletonStyles)("block");

type Statistics = z.infer<typeof PlaybackStatisticsSchema>;

type Bar = {
  label: string;
  plays: number;
  /** Null for a ranking that counts plays only. */
  watchedMs: number | null;
};

/**
 * One list of the statistics, longest bar first. Each row says its numbers
 * in words; the bar beside them is the same numbers drawn, so it is hidden
 * from assistive technology instead of being read as a second, vaguer
 * figure.
 *
 * The bar is a `<progress>`: its length comes from its `value`, which the
 * Content-Security-Policy allows where an inline `style` width is refused.
 */
function Ranking({ title, bars }: { title: string; bars: readonly Bar[] }) {
  const heading = useId();
  const top = barScale(bars.map((bar) => bar.plays));
  return (
    <section className={cx("ranking")} aria-labelledby={heading}>
      <h3 id={heading}>{title}</h3>
      {bars.length === 0 ? (
        <p className={cx("quiet")}>No plays yet.</p>
      ) : (
        <ol className={cx("bars")}>
          {bars.map((bar) => (
            <li className={cx("barRow")} key={bar.label}>
              <span className={cx("barLabel")}>{bar.label}</span>
              <span className={cx("barFigures")}>
                {playCount(bar.plays)}
                {bar.watchedMs !== null && (
                  <span className={cx("barTime")}>
                    {watchTime(bar.watchedMs)}
                  </span>
                )}
              </span>
              <progress
                className={cx("bar")}
                aria-hidden="true"
                value={bar.plays}
                max={top}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Totals({ data }: { data: Statistics }) {
  const finished = share(data.completedPlays, data.plays);
  return (
    <>
      <dl className={cx("tiles")}>
        <div className={cx("tile")}>
          <dt>Plays</dt>
          <dd>{wholeNumber(data.plays)}</dd>
        </div>
        <div className={cx("tile")}>
          <dt>Watch time</dt>
          <dd>{watchTime(data.watchedMs)}</dd>
        </div>
        <div className={cx("tile")}>
          <dt>Finished</dt>
          <dd>
            {wholeNumber(data.completedPlays)}
            {finished !== null && (
              <span className={cx("tileAside")}>{finished} of plays</span>
            )}
          </dd>
        </div>
      </dl>
      <p className={cx("note")}>
        A play shorter than {watchTime(data.minimumPlayMs)} is not counted. A
        play counts as finished once {String(data.completionPercent)}% of the
        title has been watched, which is the mark this history uses and not the
        watched tick in Plex.
      </p>
    </>
  );
}

/**
 * The plays the filters leave, in numbers: three totals, then what was
 * watched most, by whom (for the owner), on what, and how Plex played it.
 * Nothing is shown when there are no plays to count: the list below says so
 * once.
 */
export function StatisticsSection({
  view,
  showsViewers,
}: {
  view: HistoryView;
  showsViewers: boolean;
}) {
  const heading = useId();
  const stats = useQuery({
    queryKey: ["playback", "statistics", filterKey(view)],
    queryFn: async () =>
      readApi(statisticsReadPath(view), PlaybackStatisticsSchema),
    placeholderData: (previous) => previous,
  });

  function content() {
    if (stats.error !== null) {
      return (
        <ErrorState
          error={stats.error}
          what="The statistics"
          onRetry={() => {
            void stats.refetch();
          }}
        />
      );
    }
    if (stats.isPending) {
      return (
        <SkeletonStatus label="Loading statistics">
          <div className={cx("tiles")}>
            {[0, 1, 2].map((tile) => (
              <div className={cx("tile")} key={tile}>
                <div className={`${block} ${cx("skeletonShortLine")}`} />
                <div className={`${block} ${cx("skeletonFigure")}`} />
              </div>
            ))}
          </div>
          <div className={cx("rankings")}>
            {[0, 1, 2].map((ranking) => (
              <div className={cx("ranking")} key={ranking}>
                <div className={`${block} ${cx("skeletonShortLine")}`} />
                {[0, 1, 2, 3].map((bar) => (
                  <div className={`${block} ${cx("skeletonBar")}`} key={bar} />
                ))}
              </div>
            ))}
          </div>
        </SkeletonStatus>
      );
    }
    const { data } = stats;
    return (
      <div className={cx("statistics")} aria-busy={stats.isPlaceholderData}>
        <Totals data={data} />
        <div className={cx("rankings")}>
          <Ranking title="Most watched" bars={data.topTitles} />
          {showsViewers && <Ranking title="By person" bars={data.topUsers} />}
          <Ranking title="By device" bars={data.topPlatforms} />
          <Ranking
            title="How it played"
            bars={data.decisions
              .map((row) => ({
                label: PLAYBACK_DECISION_COPY[row.decision],
                plays: row.plays,
                watchedMs: null,
              }))
              .sort((left, right) => right.plays - left.plays)}
          />
        </div>
      </div>
    );
  }

  // No plays and nothing wrong: the list's own empty state covers it.
  if (stats.data?.plays === 0 && stats.error === null) return null;
  return (
    <section className={cx("section")} aria-labelledby={heading}>
      <h2 id={heading}>Statistics</h2>
      {content()}
    </section>
  );
}
