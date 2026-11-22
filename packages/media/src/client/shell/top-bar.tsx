import { useRef, useState } from "react";
import { BellIcon, SearchIcon } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  DISCOVER_PATH,
  QUERY_LIMIT,
  readSearch,
  searchAddress,
} from "#client/discover/view.ts";
import { AccountMenu } from "./account-menu.tsx";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./shell.module.css";

const cx = classNames(styles);

/** How long the field waits after the last keystroke before it searches. */
const TYPING_PAUSE = 300;

/** The search Discover is showing, or nothing on any other page. */
function shownSearch(pathname: string, search: string): string {
  return pathname === DISCOVER_PATH
    ? readSearch(new URLSearchParams(search))
    : "";
}

/** The page and query string the browser is at now, whatever was rendered. */
function browserAddress(): string {
  const { pathname, search } = globalThis.location;
  return `${pathname}${search}`;
}

/**
 * The one search field. From any page, Enter opens Discover with the search
 * in its address. On Discover itself the results follow the typing, a pause
 * behind it, so a search can be refined without leaving the field.
 */
function SearchField() {
  const location = useLocation();
  const navigate = useNavigate();
  const shown = shownSearch(location.pathname, location.search);
  const [text, setText] = useState(shown);
  // The search this field last asked for. Arriving on another page, or at an
  // address that shows any other search (Back, a link), gives the field that
  // address's text. An address on the same page that shows this search
  // leaves the field alone, because the typing may already be ahead of it.
  const [asked, setAsked] = useState(shown);
  const [synced, setSynced] = useState({
    key: location.key,
    pathname: location.pathname,
  });
  if (synced.key !== location.key) {
    setSynced({ key: location.key, pathname: location.pathname });
    if (asked !== shown || synced.pathname !== location.pathname) {
      setAsked(shown);
      setText(shown);
    }
  }
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function search(value: string) {
    globalThis.clearTimeout(pause.current);
    const { pathname, search: current } = globalThis.location;
    setAsked(readSearch(new URLSearchParams({ q: value })));
    void navigate(searchAddress(value), {
      // A search that refines the one on screen rewrites its history entry;
      // the first one adds an entry, so Back returns to what was there.
      replace: shownSearch(pathname, current) !== "",
    });
  }

  /** Drops the search that is waiting for the typing to pause, if any. */
  function dropPendingSearch() {
    globalThis.clearTimeout(pause.current);
  }

  /** Searches once the typing pauses, while Discover is the page open. */
  function searchSoon(value: string) {
    dropPendingSearch();
    if (location.pathname !== DISCOVER_PATH) return;
    // The typing refines what this address shows. Whatever the reader does
    // during the pause that takes them to another address (another page,
    // Back, "Clear search") is their later word, and the search typed before
    // it is dropped. A search this field sends cancels the pause itself, so
    // an address that changed under it was changed by something else.
    const typedAt = browserAddress();
    pause.current = globalThis.setTimeout(() => {
      if (browserAddress() === typedAt) search(value);
    }, TYPING_PAUSE);
  }

  return (
    <form
      className={cx("search")}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === "") return;
        search(text);
        // On a phone the keyboard covers the results until it is put away.
        if (globalThis.matchMedia("(pointer: coarse)").matches) {
          event.currentTarget.querySelector("input")?.blur();
        }
      }}
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
          // Text an input method is still composing is not a search yet, and
          // neither any longer is what was typed just before it: sending
          // that now would search for half of what the reader is writing.
          const { nativeEvent } = event;
          if (nativeEvent instanceof InputEvent && nativeEvent.isComposing) {
            dropPendingSearch();
            return;
          }
          searchSoon(event.target.value);
        }}
        onCompositionStart={dropPendingSearch}
        onCompositionEnd={(event) => {
          // The finished text is what gets searched for.
          searchSoon(event.currentTarget.value);
        }}
        maxLength={QUERY_LIMIT}
        enterKeyHint="search"
        required
      />
    </form>
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
