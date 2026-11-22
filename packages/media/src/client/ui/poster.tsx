import { useState } from "react";
import { ClapperboardIcon } from "lucide-react";
import { posterSources } from "./artwork.ts";
import { classNames } from "./class-names.ts";
import styles from "./poster.module.css";

const cx = classNames(styles);

/**
 * A title's poster in a fixed 2:3 frame, so the page never moves when the
 * image arrives. A title with no stored poster, or one whose image could not
 * be fetched, shows its name on a quiet card instead of a broken image. A
 * thumbnail has no room for the name, so there the card carries a film mark:
 * plainly a stand-in for a picture, not a picture that failed to load.
 *
 * The poster is decoration: it always sits beside the title as text, so the
 * image has an empty `alt` and the placeholder is hidden from assistive
 * technology. The placeholder draws the name as generated content, so the
 * text of a card that links the poster is the title once (WCAG 2.5.3).
 *
 * `sizes` is the rendered width, as for any responsive image: the browser
 * picks from the proxy's widths with it.
 *
 * `carries` names the poster for the view transition between a card and its
 * title page (`ui/motion/title-transition.ts`). Never set it from more than one poster
 * at a time.
 */
export function Poster({
  path,
  title,
  sizes,
  loading = "lazy",
  carries = false,
}: {
  path: string | null;
  title: string;
  sizes: string;
  /** `eager` for the one poster a page opens on; a list's posters wait. */
  loading?: "lazy" | "eager";
  carries?: boolean;
}) {
  // The path that failed, not a flag: a row reused for another title starts
  // with a clean slate.
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const frame = carries ? `${cx("frame")} ${cx("carries")}` : cx("frame");
  if (path === null || failedPath === path) {
    return (
      <div className={frame}>
        <div className={cx("placeholder")} aria-hidden="true">
          <span className={cx("placeholderTitle")} data-title={title} />
          <ClapperboardIcon className={cx("placeholderMark")} />
        </div>
      </div>
    );
  }
  const { src, srcSet } = posterSources(path);
  return (
    <div className={frame}>
      <img
        className={cx("image")}
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt=""
        width={342}
        height={513}
        loading={loading}
        decoding="async"
        onError={() => {
          setFailedPath(path);
        }}
      />
    </div>
  );
}
