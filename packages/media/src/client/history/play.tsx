import type { z } from "zod";
import { Link } from "react-router";
import type { PlaybackSessionViewSchema } from "#shared/household/playback.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import styles from "./history.module.css";

const cx = classNames(styles);

export type Play = z.infer<typeof PlaybackSessionViewSchema>;

/** The name a play goes by: its series for an episode, itself for a film. */
export function playName(play: Play): string {
  return play.seriesTitle ?? play.title;
}

/** The poster of the title a play belongs to, or a stand-in for it. */
export function PlayPoster({ play, sizes }: { play: Play; sizes: string }) {
  return (
    <Poster
      path={play.media?.artwork.posterPath ?? null}
      title={playName(play)}
      sizes={sizes}
    />
  );
}

/**
 * What was played: the title, as a link to its page when the household
 * holds it, and for an episode its own name beneath. A play that matches no
 * title Media has today is named and links nowhere.
 */
export function PlayTitle({ play }: { play: Play }) {
  const name = playName(play);
  return (
    <>
      {play.media === null ? (
        <span className={cx("playName")}>{name}</span>
      ) : (
        <Link
          className={cx("playName")}
          to={`/media/${encodeURIComponent(play.media.rootMediaId)}`}
        >
          {name}
        </Link>
      )}
      {play.seriesTitle !== null && (
        <p className={cx("detail")}>{play.title}</p>
      )}
    </>
  );
}
