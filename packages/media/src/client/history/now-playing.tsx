import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { NowPlayingSchema } from "#shared/household/playback.ts";
import { readApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import {
  PLAYBACK_DECISION_COPY,
  PLAYBACK_STATE_COPY,
  UNMATCHED_VIEWER,
} from "#client/presentation/playback.ts";
import { classNames } from "#client/ui/class-names.ts";
import { StatePill } from "#client/ui/poster-card.tsx";
import { SkeletonStatus } from "#client/ui/skeleton.tsx";
import skeletonStyles from "#client/ui/skeleton.module.css";
import { ErrorState } from "#client/ui/states.tsx";
import { playPosition } from "./format.ts";
import styles from "./history.module.css";
import { PlayPoster, PlayTitle, playName, type Play } from "./play.tsx";

const cx = classNames(styles);
const block = classNames(skeletonStyles)("block");

/** How often the page asks what is playing. */
const REFRESH_MS = 60_000;

function Stream({ play, showsViewer }: { play: Play; showsViewer: boolean }) {
  const position = playPosition(play.progressMs, play.durationMs);
  const viewer = play.userName ?? UNMATCHED_VIEWER;
  return (
    <li className={cx("stream")}>
      <div className={cx("streamPoster")}>
        <PlayPoster play={play} sizes="64px" />
      </div>
      <div className={cx("streamText")}>
        <PlayTitle play={play} />
        <p className={cx("detail")}>
          {showsViewer
            ? `${viewer}, on ${play.platform}`
            : `On ${play.platform}`}
        </p>
        <p className={cx("streamState")}>
          <StatePill state={PLAYBACK_STATE_COPY[play.state]} />
          <span className={cx("detail")}>
            {PLAYBACK_DECISION_COPY[play.decision]}
          </span>
        </p>
      </div>
      <div className={cx("streamPosition")}>
        <progress
          className={cx("position")}
          aria-label={`${playName(play)}: how far through`}
          value={position.value}
          max={position.max}
        />
        <span className={cx("detail")}>{position.label}</span>
      </div>
    </li>
  );
}

/**
 * What is playing in Plex right now, asked again every minute. An owner
 * sees every stream and who is watching; a member sees their own.
 */
export function NowPlaying({ showsViewer }: { showsViewer: boolean }) {
  const heading = useId();
  const playing = useQuery({
    queryKey: ["playback", "now"],
    queryFn: async () => readApi("/playback/now-playing", NowPlayingSchema),
    refetchInterval: REFRESH_MS,
  });

  function content() {
    if (playing.error !== null) {
      return (
        <ErrorState
          error={playing.error}
          what="What is playing"
          onRetry={() => {
            void playing.refetch();
          }}
        />
      );
    }
    if (playing.isPending) {
      return (
        <SkeletonStatus label="Loading what is playing">
          <div className={cx("streams")}>
            <div className={cx("stream")}>
              <div className={`${block} ${cx("skeletonPoster")}`} />
              <div className={cx("streamText")}>
                <div className={`${block} ${cx("skeletonLine")}`} />
                <div className={`${block} ${cx("skeletonShortLine")}`} />
              </div>
            </div>
          </div>
        </SkeletonStatus>
      );
    }
    const { stale, observedAt, items } = playing.data;
    if (stale) {
      // Plex has not answered lately, so an old list would be a guess.
      return (
        <p className={cx("quiet")}>
          Media cannot see what is playing right now.
          {observedAt !== null && <> It last looked {dateLabel(observedAt)}.</>}
        </p>
      );
    }
    if (items.length === 0) {
      return <p className={cx("quiet")}>Nothing is playing right now.</p>;
    }
    return (
      <ul className={cx("streams")}>
        {items.map((play) => (
          <Stream key={play.id} play={play} showsViewer={showsViewer} />
        ))}
      </ul>
    );
  }

  return (
    <section className={cx("section")} aria-labelledby={heading}>
      <h2 id={heading}>Now playing</h2>
      {content()}
    </section>
  );
}
