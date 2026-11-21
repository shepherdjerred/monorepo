import { useId, useRef, type PointerEvent } from "react";
import { EllipsisIcon, XIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  HOUSEKEEPING_NAV,
  MANAGE_NAV,
  PRIMARY_NAV,
  TAB_BAR_COUNT,
  type NavItem,
} from "./navigation.ts";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./tab-bar.module.css";

const cx = classNames(styles);

function SheetLinks({
  items,
  onFollow,
}: {
  items: readonly NavItem[];
  onFollow: () => void;
}) {
  return (
    <ul className={cx("sheetList")}>
      {items.map((item) => (
        <li key={item.to}>
          <NavLink className={cx("sheetLink")} to={item.to} onClick={onFollow}>
            <item.icon aria-hidden="true" />
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * A phone's navigation: the first destinations as tabs along the bottom and
 * the rest in a sheet behind More.
 *
 * The sheet is a native modal dialog, so the browser holds focus inside it,
 * closes it on Escape or the back gesture, and returns focus to More.
 */
export function TabBar({ user }: { user: MediaUser }) {
  const sheet = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { pathname } = useLocation();
  const tabs = PRIMARY_NAV.slice(0, TAB_BAR_COUNT);
  const more = [
    ...PRIMARY_NAV.slice(TAB_BAR_COUNT),
    ...HOUSEKEEPING_NAV,
    ...(user.role === "owner" ? [MANAGE_NAV] : []),
  ];
  const inMore = more.some(
    ({ to }) => pathname === to || pathname.startsWith(`${to}/`),
  );
  const close = () => {
    sheet.current?.close();
  };
  // A press and release on the backdrop closes the sheet. The dialog is the
  // event target for its own padding as well, so compare the position.
  const pressedOutside = useRef(false);
  const isOutside = (event: PointerEvent<HTMLDialogElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.clientY < box.top ||
      event.clientY > box.bottom ||
      event.clientX < box.left ||
      event.clientX > box.right
    );
  };
  return (
    <>
      <nav className={cx("tabBar")} aria-label="Main">
        {tabs.map((tab) => (
          <NavLink className={cx("tab")} key={tab.to} to={tab.to}>
            <tab.icon aria-hidden="true" />
            {tab.label}
          </NavLink>
        ))}
        <button
          className={cx("tab")}
          type="button"
          aria-haspopup="dialog"
          aria-current={inMore ? "true" : undefined}
          onClick={() => {
            sheet.current?.showModal();
          }}
        >
          <EllipsisIcon aria-hidden="true" />
          More
        </button>
      </nav>
      <dialog
        className={cx("sheet")}
        ref={sheet}
        aria-labelledby={titleId}
        onPointerDown={(event) => {
          pressedOutside.current = isOutside(event);
        }}
        onPointerUp={(event) => {
          if (pressedOutside.current && isOutside(event)) close();
        }}
      >
        <header className={cx("sheetHeader")}>
          <h2 id={titleId}>More</h2>
          <form method="dialog">
            <button className={cx("sheetClose")} aria-label="Close">
              <XIcon aria-hidden="true" />
            </button>
          </form>
        </header>
        <nav aria-label="More">
          <SheetLinks
            items={PRIMARY_NAV.slice(TAB_BAR_COUNT)}
            onFollow={close}
          />
          <h3 className={cx("sheetGroup")}>Housekeeping</h3>
          <SheetLinks items={HOUSEKEEPING_NAV} onFollow={close} />
          {user.role === "owner" && (
            <>
              <h3 className={cx("sheetGroup")}>Owner</h3>
              <SheetLinks items={[MANAGE_NAV]} onFollow={close} />
            </>
          )}
        </nav>
      </dialog>
    </>
  );
}
