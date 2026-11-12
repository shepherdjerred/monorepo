import { useCallback, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  defaultRangeExtractor,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import type { Issue } from "#client/data/api.ts";
import { listRestore } from "#client/data/list-restore.ts";
import { Avatar, Priority, StateDot, Swatch } from "#client/ui/ui.tsx";
import { RelativeTime } from "#client/ui/time.tsx";
import { useShell } from "#client/shell/shell-context.ts";
import { isPlainClick } from "#client/shell/route.ts";
import { registerReveal } from "#client/shell/list-navigation.ts";
import { useFreshRows } from "#client/live/remote-activity.ts";

const phone = "(max-width: 767px)";
/** A row's usual height under `list.css`, used until it has been measured. */
const usualRowHeight = () => (globalThis.matchMedia(phone).matches ? 70 : 48);

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <>
      <div className="row-labels">
        {issue.labels.slice(0, 2).map((l) => (
          <span className="label" key={l.id}>
            <Swatch color={l.color} />
            {l.name}
          </span>
        ))}
      </div>
      {issue.project !== null && (
        <Link className="row-project" to={`/projects/${issue.project.slug}`}>
          <Swatch color={issue.project.color} />
          {issue.project.name}
        </Link>
      )}
      {issue.voteCount > 0 && (
        <span className="row-votes">
          <span aria-hidden="true">↑ </span>
          {issue.voteCount}
          <span className="sr-only"> votes</span>
        </span>
      )}
      <RelativeTime
        className="row-date"
        value={issue.updatedAt}
        style="narrow"
      />
      {issue.assignee === null ? (
        <span
          className="unassigned"
          role="img"
          aria-label="Unassigned"
          title="Unassigned"
        >
          ○
        </span>
      ) : (
        <Avatar actor={issue.assignee} />
      )}
    </>
  );
}

/** What follows the rows: the next page arriving, failing, or being asked for. */
function MoreRows({ restoring }: { restoring: boolean }) {
  const { list } = useShell();
  const loadMore = useRef(list.loadMore);
  loadMore.current = list.loadMore;
  // Each of these mounts once per loaded page, so each asks for one page.
  const whenNear = useCallback((element: HTMLDivElement | null) => {
    if (element === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore.current();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const atOnce = useCallback((element: HTMLDivElement | null) => {
    if (element !== null) {
      loadMore.current();
    }
  }, []);
  if (list.moreError !== null) {
    return (
      <div className="list-more" role="alert">
        <span>Could not load more issues.</span>
        <button onClick={list.loadMore}>Retry</button>
      </div>
    );
  }
  if (list.loadingMore) {
    return (
      // The list is `aria-busy` meanwhile; no live region announces it.
      <div className="list-more">Loading more issues…</div>
    );
  }
  if (!list.hasMore) {
    return null;
  }
  return (
    <div
      key={list.pageCount}
      className="list-sentinel"
      ref={restoring ? atOnce : whenNear}
    />
  );
}

/**
 * The issue list, windowed: only the rows near the viewport are in the
 * document, so its cost does not grow with the team's backlog.
 */
export function IssueList() {
  const { list, current, setCurrent, openPeek } = useShell();
  const location = useLocation();
  const historyKey = location.key;
  const url = location.pathname + location.search;
  const { items } = list;
  const fresh = useFreshRows();
  // One row is in the tab order; J/K and the arrow keys move between rows.
  const currentIndex = items.findIndex(
    ({ identifier }) => identifier === current,
  );
  const tabStop = Math.max(0, currentIndex);
  const [restore] = useState(() => listRestore.read(historyKey, url));
  const [margin, setMargin] = useState(0);
  const rowHeight = usualRowHeight();
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: margin,
    // The router restores scroll once, before these rows exist and against
    // a page too short to scroll. The virtualizer scrolls to its initial
    // offset as it mounts, by when the rows' height is reserved.
    initialOffset: () => restore?.offset ?? globalThis.scrollY,
    initialMeasurementsCache: (restore?.sizes ?? []).map((size, index) => ({
      index,
      key: index,
      start: 0,
      end: size,
      size,
      lane: 0,
    })),
    // The focused row stays mounted while it is scrolled away, so focus and
    // the tab stop are never lost to the window.
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), tabStop])]
        .filter((index) => index < items.length)
        .sort((a, b) => a - b),
  });
  // Until the pages a reload dropped are back, keep the list as tall as it
  // was, so the saved scroll position is somewhere the page can scroll to.
  const restoring =
    restore?.url === url && list.hasMore && list.pageCount < restore.pages;
  const latest = useRef({ items, virtualizer, restoring, list });
  latest.current = { items, virtualizer, restoring, list };
  const attach = useCallback(
    (element: HTMLUListElement | null) => {
      if (element === null) {
        return;
      }
      const measure = () => {
        setMargin(
          Math.round(element.getBoundingClientRect().top + globalThis.scrollY),
        );
      };
      const resized = new ResizeObserver(measure);
      resized.observe(document.body);
      // The virtualizer is about to scroll to a restored offset.
      let offset = restore?.url === url ? restore.offset : globalThis.scrollY;
      const scrolled = () => {
        offset = globalThis.scrollY;
      };
      globalThis.addEventListener("scroll", scrolled, { passive: true });
      const save = () => {
        const state = latest.current;
        // Leaving in the middle of a restore keeps what is being restored,
        // not the part of it that has arrived so far.
        listRestore.save(
          historyKey,
          restore !== undefined && state.restoring
            ? { ...restore, offset }
            : {
                url,
                offset,
                pages: state.list.pageCount,
                size: state.virtualizer.getTotalSize(),
                sizes: state.virtualizer.measurementsCache.map(
                  ({ size }) => size,
                ),
              },
        );
      };
      globalThis.addEventListener("pagehide", save);
      const forget = registerReveal((identifier) => {
        const state = latest.current;
        const index = state.items.findIndex(
          (item) => item.identifier === identifier,
        );
        if (index === -1) {
          return false;
        }
        state.virtualizer.scrollToIndex(index, { align: "auto" });
        return true;
      });
      return () => {
        save();
        forget();
        globalThis.removeEventListener("pagehide", save);
        globalThis.removeEventListener("scroll", scrolled);
        resized.disconnect();
      };
    },
    [historyKey, url, restore],
  );
  const reserved = restoring ? restore.size : 0;
  const height = Math.max(virtualizer.getTotalSize(), reserved);
  return (
    <>
      <ul
        className="issue-list"
        aria-label="Issues"
        ref={attach}
        style={{ height }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const issue = items[row.index];
          if (issue === undefined) {
            return null;
          }
          return (
            <li
              className="issue-row"
              key={issue.id}
              ref={virtualizer.measureElement}
              data-index={row.index}
              // Another session created it a moment ago.
              data-fresh={fresh.has(issue.identifier) ? "" : undefined}
              aria-posinset={row.index + 1}
              // More pages may follow, so the full size is not known yet.
              aria-setsize={list.hasMore ? -1 : items.length}
              style={{
                transform: `translateY(${String(row.start - margin)}px)`,
              }}
            >
              <Link
                className="issue-row-main"
                to={`/issues/${issue.identifier}`}
                data-issue-row={issue.identifier}
                aria-current={current === issue.identifier ? "true" : undefined}
                tabIndex={tabStop === row.index ? 0 : -1}
                onFocus={() => {
                  setCurrent(issue.identifier);
                }}
                onClick={(event) => {
                  if (isPlainClick(event)) {
                    event.preventDefault();
                    openPeek(issue.identifier);
                  }
                }}
              >
                <Priority value={issue.priority} />
                <span className="identifier">{issue.identifier}</span>
                <StateDot color={issue.state.color} />
                <span className="issue-row-title">{issue.title}</span>
              </Link>
              <IssueRow issue={issue} />
            </li>
          );
        })}
      </ul>
      <MoreRows restoring={restoring} />
    </>
  );
}
