import { Link, NavLink } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { MANAGE_NAV, PRIMARY_NAV, type NavItem } from "./navigation.ts";
import { HOME_PATH } from "./redirects.tsx";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./shell.module.css";

const cx = classNames(styles);

function NavList({
  items,
  labelledBy,
}: {
  items: readonly NavItem[];
  labelledBy?: string;
}) {
  return (
    <ul className={cx("navList")} aria-labelledby={labelledBy}>
      {items.map((item) => (
        <li key={item.to}>
          <NavLink className={cx("navItem")} to={item.to}>
            <item.icon aria-hidden="true" />
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** Navigation for screens wide enough to keep it beside the page. */
export function Sidebar({ user }: { user: MediaUser }) {
  return (
    <aside className={cx("sidebar")}>
      <Link className={cx("brand")} to={HOME_PATH}>
        media<span className={cx("brandDot")}>.</span>
      </Link>
      <nav className={cx("nav")} aria-label="Main">
        <NavList items={PRIMARY_NAV} />
        {user.role === "owner" && (
          <div className={cx("navGroup")}>
            <p className={cx("navGroupLabel")} id="nav-owner">
              Owner
            </p>
            <NavList items={[MANAGE_NAV]} labelledBy="nav-owner" />
          </div>
        )}
      </nav>
    </aside>
  );
}
