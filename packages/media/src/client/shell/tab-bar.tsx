import { NavLink } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { MANAGE_NAV, PRIMARY_NAV } from "./navigation.ts";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./tab-bar.module.css";

const cx = classNames(styles);

/**
 * A phone's navigation: every destination as a tab along the bottom. The
 * owner's Manage is the fifth tab; nothing is behind a second step.
 */
export function TabBar({ user }: { user: MediaUser }) {
  const tabs =
    user.role === "owner" ? [...PRIMARY_NAV, MANAGE_NAV] : PRIMARY_NAV;
  return (
    <nav className={cx("tabBar")} aria-label="Main">
      {tabs.map((tab) => (
        <NavLink className={cx("tab")} key={tab.to} to={tab.to}>
          <tab.icon aria-hidden="true" />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
