import { NavLink } from "react-router";
import { PRIMARY_NAV } from "./navigation.ts";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./tab-bar.module.css";

const cx = classNames(styles);

/**
 * A phone's navigation: the five everyday destinations as tabs along the
 * bottom, the same five for everyone. The owner's Manage is not one of
 * them; on a phone it is in the account panel (`account-menu.tsx`).
 */
export function TabBar() {
  return (
    <nav className={cx("tabBar")} aria-label="Main">
      {PRIMARY_NAV.map((tab) => (
        <NavLink
          className={cx("tab")}
          key={tab.to}
          to={tab.to}
          end={tab.end === true}
        >
          <tab.icon aria-hidden="true" />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
