import { Suspense, lazy, useCallback, useRef, useState } from "react";
import { NavLink, useParams, useSearchParams } from "react-router";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { Empty, ErrorNotice } from "#client/ui/ui.tsx";
import {
  BoardSkeleton,
  ListSkeleton,
  ToolbarSkeleton,
} from "#client/ui/skeleton.tsx";
import { readDisplay } from "#client/views/display-options.ts";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import { IssueContextMenu } from "#client/controls/issue-menu.tsx";
import { DisplayMenu } from "#client/views/display-menu.tsx";
import { FilterBar } from "#client/views/filter-bar.tsx";
import { IssueList } from "./issue-list.tsx";
import { useShell } from "#client/shell/shell-context.ts";
import { rememberTeam } from "#client/shell/team.ts";
import { SaveView } from "#client/saved-views/save-view.tsx";
import { ViewIcon } from "#client/saved-views/view-icons.tsx";
import { savedViewParam } from "#client/saved-views/view-params.ts";

const Board = lazy(async () => {
  const module = await import("#client/board/board.tsx");
  return { default: module.Board };
});

/**
 * The view's title and list/board switch. It needs no data beyond its count,
 * so the loading skeleton shows the same heading in the same place.
 */
export function ViewHeading({
  count,
  views = [],
}: {
  count?: { loaded: number; more: boolean } | undefined;
  /** The saved views, once the workspace has loaded, to name one opened. */
  views?: BootstrapData["views"];
}) {
  const [params] = useSearchParams();

  const shared = new URLSearchParams(params);
  shared.delete("peek");
  const source = views.find((item) => item.id === params.get(savedViewParam));
  return (
    <div className="view-heading">
      <div>
        <h2>
          {source !== undefined && (
            <span className="heading-icon">
              <ViewIcon name={source.icon} size={16} />
            </span>
          )}
          {source?.name ??
            (params.get("mine") === "true" ? "My issues" : "All issues")}
          {count !== undefined && (
            <span className="count">
              {count.loaded}
              {/* The server reports no total; "+" says more pages exist. */}
              {count.more && (
                <>
                  <span aria-hidden="true">+</span>
                  <span className="sr-only"> or more</span>
                </>
              )}
            </span>
          )}
        </h2>
        <p>Keep the next step in sight.</p>
      </div>
      <div className="view-toggle">
        <NavLink
          to={`/issues?${shared.toString()}`}
          onClick={() => {
            localStorage.setItem("tracker.view", "list");
          }}
          aria-label="List view"
        >
          <List size={16} />
        </NavLink>
        <NavLink
          to={`/board?${shared.toString()}`}
          onClick={() => {
            localStorage.setItem("tracker.view", "board");
          }}
          aria-label="Board view"
        >
          <LayoutGrid size={16} />
        </NavLink>
      </div>
    </div>
  );
}

function ResultsSkeleton({ board }: { board: boolean }) {
  const [params] = useSearchParams();
  return board ? (
    <BoardSkeleton />
  ) : (
    <ListSkeleton grouped={readDisplay(params).groupBy !== "none"} />
  );
}

/** A list or board view while the workspace itself is still loading. */
export function ViewSkeleton({ board }: { board: boolean }) {
  return (
    <>
      <ViewHeading />
      <ToolbarSkeleton />
      <div className="issue-results">
        <div className="issue-results-body">
          <ResultsSkeleton board={board} />
        </div>
      </div>
    </>
  );
}

export function IssueView() {
  const { bootstrap, teamKey, view, list, create, selectionScope } = useShell();
  const { slug } = useParams();
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  return (
    <>
      <ViewHeading
        views={bootstrap.views}
        count={
          list.loading
            ? undefined
            : { loaded: list.items.length, more: list.hasMore }
        }
      />
      <Toolbar
        bootstrap={bootstrap}
        teamKey={teamKey}
        board={view === "board"}
        projectRoute={view === "project"}
        projectSlug={view === "project" ? slug : undefined}
      />
      {list.error !== null && <ErrorNotice error={list.error} />}
      <IssueContextMenu
        bootstrap={bootstrap}
        items={list.items}
        scope={selectionScope}
        className="issue-results"
      >
        <div
          className="issue-results-body"
          aria-busy={list.busy}
          data-placeholder={list.placeholder}
        >
          {list.loading ? (
            <ResultsSkeleton board={view === "board"} />
          ) : view === "board" ? (
            <Suspense fallback={<BoardSkeleton />}>
              <Board
                items={list.items}
                states={bootstrap.states.filter(
                  ({ teamId }) => teamId === team?.id,
                )}
              />
            </Suspense>
          ) : list.items.length === 0 ? (
            <Empty title="A little room to think">
              <p>
                No issues match this view. Create an issue or adjust your
                filters.
              </p>
              <button
                onClick={() => {
                  create();
                }}
                disabled={!bootstrap.writesEnabled}
              >
                <Plus size={14} />
                Create issue
              </button>
            </Empty>
          ) : (
            <IssueList />
          )}
        </div>
      </IssueContextMenu>
    </>
  );
}

/** Typing filters as you go without adding a history entry per keystroke. */
function SearchFilter() {
  const [params, setParams] = useSearchParams();
  const applied = params.get("q") ?? "";
  const [text, setText] = useState(applied);
  const [seen, setSeen] = useState(applied);
  const [written, setWritten] = useState(applied);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Back, Forward and "Clear filters" change the URL underneath the input.
  if (applied !== seen) {
    setSeen(applied);
    if (applied !== written) {
      setText(applied);
    }
  }
  const cancelOnUnmount = useCallback(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="filter-search">
      <Search size={14} aria-hidden="true" />
      <input
        ref={cancelOnUnmount}
        id="issue-search"
        aria-label="Search issues"
        placeholder="Search…"
        value={text}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const next = new URLSearchParams(globalThis.location.search);
            if (value === "") {
              next.delete("q");
            } else {
              next.set("q", value);
            }
            setWritten(value);
            setParams(next, { replace: true, preventScrollReset: true });
          }, 200);
        }}
      />
    </div>
  );
}

function Toolbar({
  bootstrap,
  teamKey,
  board,
  projectRoute,
  projectSlug,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
  board: boolean;
  projectRoute: boolean;
  projectSlug: string | undefined;
}) {
  const [params, setParams] = useSearchParams();
  return (
    <div className="filters">
      <SearchFilter />
      <FilterBar
        bootstrap={bootstrap}
        teamKey={teamKey}
        projectRoute={projectRoute}
      />
      <span className="spacer" />
      <SaveView
        bootstrap={bootstrap}
        teamKey={teamKey}
        board={board}
        projectSlug={projectSlug}
      />
      <EnumPicker
        id="team-picker"
        label="Team"
        variant="field"
        value={teamKey}
        options={bootstrap.teams.map((team) => ({
          value: team.key,
          label: team.name,
          icon: <span className="team-icon">{team.key}</span>,
        }))}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("team", value);
          // Statuses and labels belong to a team.
          next.delete("state");
          next.delete("label");
          next.delete("collapsed");
          // A view belongs to the list it was opened as.
          next.delete(savedViewParam);
          rememberTeam(value);
          setParams(next, { preventScrollReset: true });
        }}
      />
      <DisplayMenu board={board} />
    </div>
  );
}
