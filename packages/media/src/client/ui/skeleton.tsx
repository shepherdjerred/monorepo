import type { ReactNode } from "react";
import { classNames } from "./class-names.ts";
import gridStyles from "./poster-card.module.css";
import styles from "./skeleton.module.css";

const cx = classNames(styles);
// The poster grid's own columns, so nothing moves when cards replace blocks.
const grid = classNames(gridStyles);

/**
 * The shape of content that is on its way, in the space it will take, so the
 * page does not jump when it arrives. The blocks are decoration; the one
 * thing announced is `label`, as a status.
 */
function Loading({ label, children }: { label: string; children: ReactNode }) {
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
    <Loading label={label}>
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
    </Loading>
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
    <Loading label={label}>
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
    </Loading>
  );
}
