import type { LucideIcon } from "lucide-react";
import { Link, type To } from "react-router";
import { classNames } from "./class-names.ts";
import { SAME_PAGE } from "./same-page.ts";
import styles from "./segmented.module.css";

const cx = classNames(styles);

export type Segment = {
  to: To;
  label: string;
  current: boolean;
  /**
   * A number beside the label, such as how many titles are leaving, and the
   * words a screen reader hears for it ("6 titles"). Zero shows nothing.
   */
  count?: { value: number; label: string };
  /** Shown instead of the label, which stays as the accessible name. */
  icon?: LucideIcon;
};

function counted(segment: Segment): boolean {
  return segment.count !== undefined && segment.count.value > 0;
}

/**
 * The name a segment needs spelled out: an icon has no words of its own, and
 * a bare number after a label is clearer as "Leaving soon, 6 titles". A plain
 * label names itself.
 */
function accessibleName(segment: Segment): string | undefined {
  if (segment.count !== undefined && counted(segment)) {
    return `${segment.label}, ${segment.count.label}`;
  }
  return segment.icon === undefined ? undefined : segment.label;
}

/**
 * A row of mutually exclusive views of one page, each with its own address.
 *
 * Every segment is a link, so this is navigation and not an ARIA tablist: the
 * views can be bookmarked, opened in a new tab, and reached with Tab like any
 * other link. `marks` is what the current segment is the current one of:
 * a `page` when the segments are addresses of their own, or `true` when they
 * are states of the same address.
 *
 * Following a segment keeps the scroll position and, through the link state
 * in `same-page.ts`, leaves focus on the segment: the reader is switching
 * views, not leaving the page.
 */
export function Segmented({
  label,
  segments,
  marks = "page",
}: {
  label: string;
  segments: readonly Segment[];
  marks?: "page" | "true";
}) {
  return (
    <nav className={cx("segmented")} aria-label={label}>
      <ul className={cx("list")}>
        {segments.map((segment) => (
          <li key={segment.label}>
            <Link
              className={cx("segment")}
              to={segment.to}
              aria-current={segment.current ? marks : undefined}
              aria-label={accessibleName(segment)}
              title={segment.icon === undefined ? undefined : segment.label}
              state={SAME_PAGE}
              preventScrollReset
              replace={marks === "true"}
            >
              {segment.icon === undefined ? (
                segment.label
              ) : (
                <segment.icon aria-hidden="true" />
              )}
              {/* The flex gap draws the space before the number; the space
                  character keeps label and number two words in the text. */}
              {counted(segment) && (
                <>
                  {" "}
                  <span className={cx("count")}>{segment.count?.value}</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
