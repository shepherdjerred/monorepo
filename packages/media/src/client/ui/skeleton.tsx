import type { ReactNode } from "react";
import { classNames } from "./class-names.ts";
import gridStyles from "./poster-card.module.css";
import railStyles from "./poster-rail.module.css";
import styles from "./skeleton.module.css";

const cx = classNames(styles);
// The poster grid's own columns, so nothing moves when cards replace blocks.
const grid = classNames(gridStyles);
// And the rail's own track and card width, for the same reason.
const rail = classNames(railStyles);

/**
 * The shape of content that is on its way, in the space it will take, so the
 * page does not jump when it arrives. The blocks are decoration; the one
 * thing announced is `label`, as a status.
 */
export function SkeletonStatus({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** A poster grid's worth of cards that are still loading. */
export function PosterGridSkeleton({
  label,
  count = 14,
}: {
  label: string;
  count?: number;
}) {
  return (
    <SkeletonStatus label={label}>
      <div className={grid("gridFrame")}>
        <div className={grid("grid")}>
          {Array.from({ length: count }, (_, index) => (
            <div key={index}>
              <div className={`${cx("block")} ${cx("poster")}`} />
              <div className={`${cx("block")} ${cx("line")}`} />
              <div className={`${cx("block")} ${cx("shortLine")}`} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonStatus>
  );
}

/**
 * A poster rail that is still loading, in exactly the room the rail will
 * take: the same track, card width, and text block (`PosterRail`).
 */
export function PosterRailSkeleton({
  label,
  count = 10,
}: {
  label: string;
  count?: number;
}) {
  return (
    <SkeletonStatus label={label}>
      <div className={rail("rail")}>
        <div className={`${rail("track")} ${rail("still")}`}>
          {Array.from({ length: count }, (_, index) => (
            <div key={index}>
              <div className={`${cx("block")} ${cx("poster")}`} />
              <div className={grid("railText")}>
                <div className={`${cx("block")} ${cx("line")}`} />
                <div className={`${cx("block")} ${cx("shortLine")}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonStatus>
  );
}

/** A list's worth of rows that are still loading. */
export function RowsSkeleton({
  label,
  count = 6,
}: {
  label: string;
  count?: number;
}) {
  return (
    <SkeletonStatus label={label}>
      <div className={cx("rows")}>
        {Array.from({ length: count }, (_, index) => (
          <div className={cx("row")} key={index}>
            <div className={`${cx("block")} ${cx("thumb")}`} />
            <div className={cx("rowText")}>
              <div className={`${cx("block")} ${cx("line")}`} />
              <div className={`${cx("block")} ${cx("shortLine")}`} />
            </div>
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}
