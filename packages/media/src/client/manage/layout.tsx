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

type MeasuredBox = Pick<DOMRectReadOnly, "left" | "right">;

export type ScrollableSectionRow = {
  scrollLeft: number;
  getBoundingClientRect: () => MeasuredBox;
  querySelector: (
    selector: string,
  ) => { getBoundingClientRect: () => MeasuredBox } | null;
};

/**
 * Scrolls the current Manage section into view and re-runs once web fonts
 * settle, so mobile strip positions do not vary with fallback font widths.
 */
export function revealCurrentSection(
  row: ScrollableSectionRow | null,
  pathname: string,
  fontsReady: Promise<unknown> = document.fonts.ready,
): (() => void) | undefined {
  if (row === null) return;
  const section = SECTIONS.find(
    ({ to }) => pathname === to || pathname.startsWith(`${to}/`),
  );
  if (section === undefined) return;
  const baseScrollLeft = row.scrollLeft;
  let appliedScrollLeft = baseScrollLeft;
  const reveal = () => {
    if (row.scrollLeft !== appliedScrollLeft) return;
    const current = row.querySelector(`a[href="${section.to}"]`);
    if (current === null) return;
    const rowBox = row.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    const contentLeft = row.scrollLeft + box.left - rowBox.left;
    const contentRight = row.scrollLeft + box.right - rowBox.left;
    const rowWidth = rowBox.right - rowBox.left;
    const next =
      contentLeft < baseScrollLeft || contentRight > baseScrollLeft + rowWidth
        ? Math.max(0, contentLeft - 16)
        : baseScrollLeft;
    if (row.scrollLeft !== next) {
      row.scrollLeft = next;
    }
    appliedScrollLeft = row.scrollLeft;
  };
  reveal();
  let cancelled = false;
  const revealAfterFonts = async () => {
    await fontsReady;
    if (!cancelled) reveal();
  };
  void revealAfterFonts();
  return () => {
    cancelled = true;
  };
}

/**
 * The Manage area: a list of its pages beside the page itself. The list is a
 * rail when there is room and a scrolling row when there is not.
 */
export function ManageLayout() {
  const { pathname } = useLocation();
  const revealCurrent = useCallback(
    (row: HTMLUListElement | null) => revealCurrentSection(row, pathname),
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
