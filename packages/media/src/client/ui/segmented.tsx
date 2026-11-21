import type { LucideIcon } from "lucide-react";
import { Link, type To } from "react-router";
import { classNames } from "./class-names.ts";
import styles from "./segmented.module.css";

const cx = classNames(styles);

export type Segment = {
  to: To;
  label: string;
  current: boolean;
  /** A number beside the label, such as how many titles are leaving. */
  count?: number;
  /** Shown instead of the label, which stays as the accessible name. */
  icon?: LucideIcon;
};

/**
 * A row of mutually exclusive views of one page, each with its own address.
 *
 * Every segment is a link, so this is navigation and not an ARIA tablist: the
 * views can be bookmarked, opened in a new tab, and reached with Tab like any
 * other link. `marks` is what the current segment is the current one of:
 * a `page` when the segments are addresses of their own, or `true` when they
 * are states of the same address.
 *
 * Following a segment keeps the scroll position: the reader is switching
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
              aria-label={
                segment.icon === undefined ? undefined : segment.label
              }
              title={segment.icon === undefined ? undefined : segment.label}
              preventScrollReset
              replace={marks === "true"}
            >
              {segment.icon === undefined ? (
                segment.label
              ) : (
                <segment.icon aria-hidden="true" />
              )}
              {segment.count !== undefined && segment.count > 0 && (
                <span className={cx("count")}>{segment.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
