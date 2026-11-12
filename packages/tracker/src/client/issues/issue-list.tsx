import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import {
  defaultRangeExtractor,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import { listRestore } from "#client/data/list-restore.ts";
import { localToday } from "#client/due/dates.ts";
import {
  priorityOptions,
  stateOptions,
  teamStates,
} from "#client/controls/property-options.tsx";
import {
  extendSelection,
  selectionStore,
  toggleSelected,
  useSelection,
  type Selection,
} from "#client/controls/selection.ts";
import { useShell } from "#client/shell/shell-context.ts";
import { registerReveal } from "#client/shell/list-navigation.ts";
import { useFreshRows } from "#client/live/remote-activity.ts";
import { readDisplay, toggleCollapsed } from "#client/views/display-options.ts";
import {
  buildRows,
  type GroupHeader,
  type ListRow,
} from "#client/views/grouping.ts";
import { GroupHeading, IssueRowItem, type RowOptions } from "./issue-row.tsx";

const phone = "(max-width: 767px)";
/** A row's usual height under `list.css`, used until it has been measured. */
const usualRowHeight = () => (globalThis.matchMedia(phone).matches ? 70 : 48);
const headerHeight = 38;
/** A grouped list loads this many pages at once so groups fill in early. */
const eagerPages = 10;

/** What follows the rows: the next page arriving, failing, or being asked for. */
function MoreRows({ eager }: { eager: boolean }) {
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
      ref={eager ? atOnce : whenNear}
    />
  );
}

const rowKey = (row: ListRow) =>
  row.kind === "group" ? `group:${row.key}` : row.issue.id;

/** The header of the group the top of the window is in, once it scrolled off. */
function stickyHeader(
  rows: readonly ListRow[],
  firstVisible: number,
): GroupHeader | undefined {
  for (let index = firstVisible; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "group") {
      return index === firstVisible ? undefined : row;
    }
  }
  return undefined;
}

/**
 * The issue list, windowed: only the rows near the viewport are in the
 * document, so its cost does not grow with the team's backlog. Group
 * headers are rows of the window too; issue rows count their position among
 * the issues a reader can reach, so collapsed groups are not counted.
 */
export function IssueList() {
  const shell = useShell();
  const { list, current, setCurrent, openPeek, bootstrap } = shell;
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const historyKey = location.key;
  const url = location.pathname + location.search;
  const display = readDisplay(params);
  const team = bootstrap.teams.find(({ key }) => key === shell.teamKey);
  const allStates = useMemo(
    () => (team === undefined ? [] : teamStates(bootstrap, team.id)),
    [bootstrap, team],
  );
  // A status filter limits the status groups to the statuses it keeps.
  const stateFilter = params.getAll("state").join("\n");
  const states = useMemo(() => {
    const kept = stateFilter === "" ? [] : stateFilter.split("\n");
    return kept.length === 0
      ? allStates
      : allStates.filter(({ name }) => kept.includes(name));
  }, [allStates, stateFilter]);
  const today = localToday();
  const { rows, issues } = useMemo(
    () =>
      buildRows(list.items, {
        groupBy: display.groupBy,
        collapsed: display.collapsed,
        states,
        today,
      }),
    [list.items, display.groupBy, display.collapsed, states, today],
  );
  const order = useMemo(
    () => issues.map(({ identifier }) => identifier),
    [issues],
  );
  const selection = useSelection(shell.selectionScope);
  const selecting = selection.ids.size > 0;
  const statusChoices = useMemo(() => stateOptions(allStates), [allStates]);
  const options: RowOptions = {
    states: statusChoices,
    priorities: priorityOptions,
    hidden: display.hidden,
    disabled: !bootstrap.writesEnabled,
  };
  const fresh = useFreshRows();
  // One row is in the tab order; J/K and the arrow keys move between rows.
  const currentIndex = rows.findIndex(
    (row) => row.kind === "issue" && row.issue.identifier === current,
  );
  const tabStop = Math.max(
    0,
    currentIndex === -1
      ? rows.findIndex((row) => row.kind === "issue")
      : currentIndex,
  );
  const [restore] = useState(() => listRestore.read(historyKey, url));
  const [margin, setMargin] = useState(0);
  const rowHeight = usualRowHeight();
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) =>
      rows[index]?.kind === "group" ? headerHeight : rowHeight,
    // Rows are measured by position, as the restored sizes are saved.
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
        .filter((index) => index < rows.length)
        .sort((a, b) => a - b),
  });
  // Until the pages a reload dropped are back, keep the list as tall as it
  // was, so the saved scroll position is somewhere the page can scroll to.
  const restoring =
    restore?.url === url && list.hasMore && list.pageCount < restore.pages;
  const latest = useRef({ rows, order, virtualizer, restoring, list });
  latest.current = { rows, order, virtualizer, restoring, list };
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
      const forget = registerReveal(
        (identifier) => {
          const state = latest.current;
          const index = state.rows.findIndex(
            (row) =>
              row.kind === "issue" && row.issue.identifier === identifier,
          );
          if (index === -1) {
            return false;
          }
          state.virtualizer.scrollToIndex(index, { align: "auto" });
          return true;
        },
        () => latest.current.order,
      );
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
  const virtualRows = virtualizer.getVirtualItems();
  const offset = (virtualizer.scrollOffset ?? 0) - margin;
  const firstVisible =
    virtualRows.find((item) => item.end > offset)?.index ?? 0;
  const sticky = offset > 0 ? stickyHeader(rows, firstVisible) : undefined;
  const setSize = list.hasMore ? -1 : issues.length;
  const toggleGroup = (key: string) => {
    setParams(toggleCollapsed(params, key), {
      replace: true,
      preventScrollReset: true,
    });
  };
  const createIn = (header: GroupHeader) =>
    display.groupBy === "status" && bootstrap.writesEnabled
      ? () => {
          shell.create({ stateName: header.key });
        }
      : undefined;
  const update = (change: (value: Selection) => Selection) => {
    selectionStore.update(shell.selectionScope, change);
  };
  return (
    <div className="issue-list-frame" data-selecting={selecting}>
      {sticky !== undefined && (
        <div className="group-sticky" aria-hidden="true">
          <GroupHeading
            header={sticky}
            toggle={() => {
              toggleGroup(sticky.key);
            }}
            create={createIn(sticky)}
            focusable={false}
          />
        </div>
      )}
      <ul
        className="issue-list"
        aria-label="Issues"
        ref={attach}
        style={{ height }}
      >
        {virtualRows.map((item) => {
          const row = rows[item.index];
          if (row === undefined) {
            return null;
          }
          const style = {
            transform: `translateY(${String(item.start - margin)}px)`,
          };
          if (row.kind === "group") {
            return (
              <li
                className="group-row"
                key={rowKey(row)}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={style}
              >
                <GroupHeading
                  header={row}
                  toggle={() => {
                    toggleGroup(row.key);
                  }}
                  create={createIn(row)}
                />
              </li>
            );
          }
          const { identifier } = row.issue;
          return (
            <IssueRowItem
              key={rowKey(row)}
              issue={row.issue}
              position={row.position}
              setSize={setSize}
              placement={{
                index: item.index,
                measure: virtualizer.measureElement,
                style,
              }}
              options={options}
              state={{
                current: current === identifier,
                tabbable: tabStop === item.index,
                selected: selection.ids.has(identifier),
                fresh: fresh.has(identifier),
              }}
              actions={{
                focus: () => {
                  setCurrent(identifier);
                },
                open: () => {
                  openPeek(identifier);
                },
                toggle: () => {
                  update((value) => toggleSelected(value, identifier));
                },
                extend: () => {
                  update((value) =>
                    extendSelection(
                      value,
                      order,
                      current ?? identifier,
                      identifier,
                    ),
                  );
                  setCurrent(identifier);
                },
              }}
            />
          );
        })}
      </ul>
      <MoreRows
        eager={
          restoring ||
          (display.groupBy !== "none" && list.pageCount < eagerPages)
        }
      />
    </div>
  );
}
