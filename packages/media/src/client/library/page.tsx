import { Outlet, useLocation } from "react-router";
import { LIBRARY_VIEW_NAMES } from "#shared/household/names.ts";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Segmented } from "#client/ui/segmented.tsx";
import styles from "./library.module.css";
import { leavingTitles, useRemovals } from "./removals.ts";

const cx = classNames(styles);

const SEGMENTS = [
  { to: "/library", label: LIBRARY_VIEW_NAMES.all },
  { to: "/library/mine", label: LIBRARY_VIEW_NAMES.mine },
  { to: "/library/leaving", label: LIBRARY_VIEW_NAMES.leaving },
  { to: "/library/removed", label: LIBRARY_VIEW_NAMES.removed },
] as const;

/**
 * The Library: one page with four views of the household's titles. Each view
 * is a route of its own beneath this one, so the heading and the segment
 * control stay put while the view changes.
 */
export function LibraryPage() {
  const { pathname } = useLocation();
  const removals = useRemovals();
  // How many titles are about to leave, on the segment that lists them.
  const leaving =
    removals.data === undefined ? 0 : leavingTitles(removals.data).length;
  return (
    <>
      <div className={cx("header")}>
        <PageTitle title="Library">
          <p>Everything your household has, and what is on its way.</p>
        </PageTitle>
        <Segmented
          label="Library views"
          segments={SEGMENTS.map((segment) => ({
            ...segment,
            current: pathname === segment.to,
            ...(segment.to === "/library/leaving"
              ? {
                  count: {
                    value: leaving,
                    label: `${String(leaving)} ${leaving === 1 ? "title" : "titles"}`,
                  },
                }
              : {}),
          }))}
        />
      </div>
      <Outlet />
    </>
  );
}
