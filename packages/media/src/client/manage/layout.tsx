import { useCallback } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./manage.module.css";

const cx = classNames(styles);

/** The owner's pages, in the order the sub-navigation lists them. */
const SECTIONS = [
  { to: "/manage/household", label: "Household" },
  { to: "/manage/quality", label: "Quality" },
  { to: "/manage/subtitles", label: "Subtitles" },
  { to: "/manage/plex", label: "Plex" },
  { to: "/manage/numbering", label: "Numbering" },
  { to: "/manage/providers", label: "Providers" },
  { to: "/manage/activity", label: "Activity" },
  { to: "/manage/recovery", label: "Recovery" },
  { to: "/manage/migration", label: "Migration" },
] as const;

/**
 * The Manage area: a list of its pages beside the page itself. The list is a
 * rail when there is room and a scrolling row when there is not.
 */
export function ManageLayout() {
  const { pathname } = useLocation();
  // In the scrolling row the current page can start out of view. React runs
  // this ref again whenever the page changes.
  const revealCurrent = useCallback(
    (row: HTMLUListElement | null) => {
      const section = SECTIONS.find(
        ({ to }) => pathname === to || pathname.startsWith(`${to}/`),
      );
      const current =
        section === undefined
          ? null
          : row?.querySelector(`a[href="${section.to}"]`);
      if (row == null || current == null) return;
      const rowBox = row.getBoundingClientRect();
      const box = current.getBoundingClientRect();
      if (box.left < rowBox.left || box.right > rowBox.right) {
        row.scrollLeft += box.left - rowBox.left - 16;
      }
    },
    [pathname],
  );
  return (
    <div className={cx("layout")}>
      <div className={cx("columns")}>
        <nav className={cx("rail")} aria-label="Manage">
          <ul className={cx("list")} ref={revealCurrent}>
            {SECTIONS.map((section) => (
              <li key={section.to}>
                <NavLink className={cx("link")} to={section.to}>
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={cx("page")}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
