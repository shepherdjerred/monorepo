import { Suspense, lazy, useCallback, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { Empty, ErrorNotice } from "#client/ui/ui.tsx";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import { IssueContextMenu } from "#client/controls/issue-menu.tsx";
import { DisplayMenu } from "#client/views/display-menu.tsx";
import { FilterBar } from "#client/views/filter-bar.tsx";
import { IssueList } from "./issue-list.tsx";
import { useShell } from "#client/shell/shell-context.ts";
import { rememberTeam } from "#client/shell/team.ts";

const Board = lazy(async () => {
  const module = await import("#client/board/board.tsx");
  return { default: module.Board };
});

export function IssueView() {
  const { bootstrap, teamKey, view, list, create, selectionScope } = useShell();
  const [params] = useSearchParams();
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  const shared = new URLSearchParams(params);
  shared.delete("peek");
  return (
    <>
      <div className="view-heading">
        <div>
          <h2>
            {params.get("mine") === "true" ? "My issues" : "All issues"}
            <span className="count">
              {list.items.length}
              {/* The server reports no total; "+" says more pages exist. */}
              {list.hasMore && (
                <>
                  <span aria-hidden="true">+</span>
                  <span className="sr-only"> or more</span>
                </>
              )}
            </span>
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
      <Toolbar
        bootstrap={bootstrap}
        teamKey={teamKey}
        board={view === "board"}
        projectRoute={view === "project"}
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
            <div className="loading">Loading issues…</div>
          ) : view === "board" ? (
            <Suspense fallback={<div className="loading">Loading board…</div>}>
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
}: {
  bootstrap: BootstrapData;
  teamKey: string;
  board: boolean;
  projectRoute: boolean;
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
          rememberTeam(value);
          setParams(next, { preventScrollReset: true });
        }}
      />
      <DisplayMenu board={board} />
    </div>
  );
}
