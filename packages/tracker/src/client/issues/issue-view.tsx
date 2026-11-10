import { Suspense, lazy, useCallback, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { Empty, ErrorNotice } from "#client/ui/ui.tsx";
import { IssueList } from "./issue-list.tsx";
import { FilterMenu } from "./filter-menu.tsx";
import { useShell } from "#client/shell/shell-context.ts";
import { rememberTeam } from "#client/shell/team.ts";

const Board = lazy(async () => {
  const module = await import("#client/board/board.tsx");
  return { default: module.Board };
});

export function IssueView() {
  const { bootstrap, teamKey, view, list, create } = useShell();
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
      <Filters bootstrap={bootstrap} teamKey={teamKey} />
      {list.error !== null && <ErrorNotice error={list.error} />}
      <div
        className="issue-results"
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
              No issues match this view. Create an issue or adjust your filters.
            </p>
            <button onClick={create} disabled={!bootstrap.writesEnabled}>
              <Plus size={14} />
              Create issue
            </button>
          </Empty>
        ) : (
          <IssueList />
        )}
      </div>
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
      <Search size={14} />
      <input
        ref={cancelOnUnmount}
        id="issue-search"
        aria-label="Search issues"
        placeholder="Filter issues…"
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

function Filters({
  bootstrap,
  teamKey,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
}) {
  const [params, setParams] = useSearchParams();
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    if (key === "team") {
      next.delete("state");
      next.delete("label");
      rememberTeam(value);
    }
    setParams(next, { preventScrollReset: true });
  }
  return (
    <div className="filters">
      <SearchFilter />
      <select
        aria-label="Filter team"
        value={teamKey}
        onChange={(e) => {
          change("team", e.target.value);
        }}
      >
        {bootstrap.teams.map((t) => (
          <option value={t.key} key={t.id}>
            {t.key}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter status"
        value={params.get("state") ?? ""}
        onChange={(e) => {
          change("state", e.target.value);
        }}
      >
        <option value="">All statuses</option>
        {bootstrap.states
          .filter((s) => s.teamId === team?.id)
          .map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
      </select>
      <select
        aria-label="Filter label"
        value={params.get("label") ?? ""}
        onChange={(e) => {
          change("label", e.target.value);
        }}
      >
        <option value="">All labels</option>
        {bootstrap.labels
          .filter((l) => l.teamId === team?.id)
          .map((l) => (
            <option key={l.id}>{l.name}</option>
          ))}
      </select>
      <select
        aria-label="Filter project"
        value={params.get("project") ?? ""}
        onChange={(e) => {
          change("project", e.target.value);
        }}
      >
        <option value="">All projects</option>
        {bootstrap.projects.map((p) => (
          <option key={p.id} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="spacer" />
      <FilterMenu bootstrap={bootstrap} teamKey={teamKey} />
      <select
        aria-label="Sort issues"
        value={params.get("sort") ?? "updated"}
        onChange={(e) => {
          change("sort", e.target.value);
        }}
      >
        <option value="updated">Recently updated</option>
        <option value="created">Recently created</option>
        <option value="priority">Priority</option>
        <option value="votes">Most votes</option>
      </select>
      <label className="archive-filter">
        <input
          type="checkbox"
          checked={params.get("archived") === "true"}
          onChange={(e) => {
            change("archived", e.target.checked ? "true" : "");
          }}
        />
        Archived
      </label>
    </div>
  );
}
