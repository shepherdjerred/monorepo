import { useState, type ReactNode } from "react";
import type { Artwork } from "#shared/artwork/contract.ts";
import type { Copy } from "#client/presentation/copy.ts";
import { artworkUrl } from "#client/ui/artwork.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { StatePill } from "#client/ui/poster-card.tsx";
import { useHeroPosterCarries } from "#client/ui/motion/title-transition.ts";
import styles from "./hero.module.css";

const cx = classNames(styles);

/** The hero poster is about 176px wide beside the sidebar, 104px on a phone. */
export const POSTER_SIZES = "(min-width: 761px) 176px, 104px";
/** The backdrop spans the page column: the screen less the sidebar. */
const BACKDROP_SIZES = "(min-width: 761px) calc(100vw - 296px), 100vw";

/**
 * The wide picture behind a title, in a band of fixed height so nothing
 * below it moves when it arrives. It is the largest image on the page, so it
 * alone is fetched at high priority. A title with no backdrop, or one that
 * could not be fetched, keeps the band as a quiet wash.
 */
function Backdrop({ path }: { path: string | null }) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  return (
    <div className={cx("backdrop")}>
      {path !== null && failedPath !== path && (
        <img
          className={cx("backdropImage")}
          src={artworkUrl("w1280", path)}
          srcSet={`${artworkUrl("w780", path)} 780w, ${artworkUrl("w1280", path)} 1280w`}
          sizes={BACKDROP_SIZES}
          alt=""
          width={1280}
          height={720}
          fetchPriority="high"
          decoding="async"
          onError={() => {
            setFailedPath(path);
          }}
        />
      )}
    </div>
  );
}

/**
 * The head of a title page: its art, its name, one phrase saying where it
 * stands, what it is about, and in `children` what the reader can do.
 *
 * The heading takes focus after a navigation (`shell/route-focus.ts`).
 */
export function Hero({
  title,
  artwork,
  trail,
  meta,
  state,
  overview,
  children,
}: {
  title: string;
  artwork: Artwork;
  /** Links up to what this title is part of, above the heading. */
  trail?: ReactNode;
  /** Short facts beside the state: what kind of title it is, and its year. */
  meta: readonly string[];
  state: Copy | null;
  overview: string | null;
  children: ReactNode;
}) {
  const carries = useHeroPosterCarries();
  return (
    <header className={cx("hero")}>
      {/* One string child: React leaves a title with several text nodes empty. */}
      <title>{`${title} · Media`}</title>
      <Backdrop path={artwork.backdropPath} />
      <div className={cx("content")}>
        <div className={cx("poster")}>
          <Poster
            path={artwork.posterPath}
            title={title}
            sizes={POSTER_SIZES}
            loading="eager"
            carries={carries}
          />
        </div>
        <div className={cx("head")}>
          {trail !== undefined && <p className={cx("trail")}>{trail}</p>}
          <h1 className={cx("title")} tabIndex={-1}>
            {title}
          </h1>
          <ul className={cx("meta")}>
            {meta.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
            {state !== null && (
              <li>
                <StatePill state={state} />
              </li>
            )}
          </ul>
        </div>
        <div className={cx("body")}>
          {overview !== null && overview.length > 0 && (
            <p className={cx("overview")}>{overview}</p>
          )}
          {children}
        </div>
      </div>
    </header>
  );
}
