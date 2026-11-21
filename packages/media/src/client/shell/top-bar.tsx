import { useState } from "react";
import { BellIcon, SearchIcon } from "lucide-react";
import { Form, NavLink, useLocation } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { AccountMenu } from "./account-menu.tsx";
import { HOME_PATH } from "./redirects.tsx";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./shell.module.css";

const cx = classNames(styles);

/** The search Discover is showing, or nothing on any other page. */
function shownSearch(pathname: string, search: string): string {
  return pathname === HOME_PATH
    ? (new URLSearchParams(search).get("q") ?? "")
    : "";
}

function SearchField() {
  const location = useLocation();
  const [text, setText] = useState(() =>
    shownSearch(location.pathname, location.search),
  );
  // Every navigation resets the field to what the new page shows, without
  // remounting it: searching again from Discover keeps the caret in place.
  const [syncedTo, setSyncedTo] = useState(location.key);
  if (syncedTo !== location.key) {
    setSyncedTo(location.key);
    setText(shownSearch(location.pathname, location.search));
  }
  return (
    <Form
      className={cx("search")}
      role="search"
      method="get"
      action={HOME_PATH}
    >
      <SearchIcon aria-hidden="true" />
      <input
        type="search"
        name="q"
        aria-label="Search films and series"
        placeholder="Search films and series"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        maxLength={200}
        enterKeyHint="search"
        required
      />
    </Form>
  );
}

/**
 * Search, notifications, and the account, kept in view above every page.
 *
 * The bell carries no count: the notifications the API returns are delivery
 * records with no read state, so an unread number could not be an honest one.
 */
export function TopBar({
  user,
  signingOut,
  onSignOut,
}: {
  user: MediaUser;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <header className={cx("topBar")}>
      <SearchField />
      <div className={cx("topActions")}>
        <NavLink
          className={cx("iconButton")}
          to="/notifications"
          aria-label="Notifications"
        >
          <BellIcon aria-hidden="true" />
        </NavLink>
        <AccountMenu
          user={user}
          signingOut={signingOut}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  );
}
