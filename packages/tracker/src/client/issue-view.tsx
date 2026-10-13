import { useQuery } from "@tanstack/react-query";
import { NavLink, useSearchParams } from "react-router";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { api, type BootstrapData, type Issue } from "./api.ts";
import { IssueListSchema } from "#shared/schema.ts";
import { currentActor } from "./identity.ts";
import { Board } from "./board.tsx";
import { Empty, ErrorNotice } from "./ui.tsx";
import { IssueList } from "./pages.tsx";
import { FilterMenu } from "./filter-menu.tsx";

export function useIssueView(page: string, projectSlug?: string) {
  const [params] = useSearchParams();
  const input = IssueListSchema.parse({
    teamKey: params.get("team") ?? "AI",
    projectSlug: projectSlug ?? params.get("project") ?? undefined,
    search: params.get("q") ?? undefined,
    states: params.getAll("state"),
    labels: params.getAll("label"),
    assigneeKey:
      params.get("mine") === "true"
        ? currentActor().key
        : (params.get("assignee") ?? undefined),
    creatorKey: params.get("creator") ?? undefined,
    priority: params.has("priority")
      ? Number(params.get("priority"))
      : undefined,
    includeArchived: params.get("archived") === "true",
    sort: page === "board" ? "board" : (params.get("sort") ?? "updated"),
    limit: "all",
  });
  return useQuery({
    queryKey: ["issues", input],
    queryFn: () => api.issues.list.query(input),
    enabled:
      ["issues", "board"].includes(page) ||
      (page === "projects" && projectSlug !== undefined),
  });
}

type ViewProps = {
  bootstrap: BootstrapData;
  page: string;
  items: Issue[];
  selected: number;
  select: (index: number) => void;
  open: (identifier: string) => void;
  create: () => void;
  loading: boolean;
  error: unknown;
};
export function IssueView(props: ViewProps) {
  const [params] = useSearchParams();
  const team = props.bootstrap.teams.find(
    ({ key }) => key === (params.get("team") ?? "AI"),
  );
  return (
    <>
      <div className="view-heading">
        <div>
          <h2>
            {params.get("mine") === "true" ? "My issues" : "All issues"}
            <span className="count">{props.items.length}</span>
          </h2>
          <p>Keep the next step in sight.</p>
        </div>
        <div className="view-toggle">
          <NavLink
            to={`/issues?${params.toString()}`}
            onClick={() => {
              localStorage.setItem("tracker.view", "list");
            }}
            aria-label="List view"
          >
            <List size={16} />
          </NavLink>
          <NavLink
            to={`/board?${params.toString()}`}
            onClick={() => {
              localStorage.setItem("tracker.view", "board");
            }}
            aria-label="Board view"
          >
            <LayoutGrid size={16} />
          </NavLink>
        </div>
      </div>
      <Filters bootstrap={props.bootstrap} select={props.select} />
      {props.error !== null && <ErrorNotice error={props.error} />}
      {props.loading ? (
        <div className="loading">Loading issues…</div>
      ) : props.page === "board" ? (
        <Board
          items={props.items}
          states={props.bootstrap.states.filter(
            ({ teamId }) => teamId === team?.id,
          )}
        />
      ) : props.items.length === 0 ? (
        <Empty title="A little room to think">
          <p>
            No issues match this view. Create an issue or adjust your filters.
          </p>
          <button
            onClick={props.create}
            disabled={!props.bootstrap.writesEnabled}
          >
            <Plus size={14} />
            Create issue
          </button>
        </Empty>
      ) : (
        <IssueList
          items={props.items}
          selected={props.selected}
          select={props.select}
          open={props.open}
        />
      )}
    </>
  );
}

function Filters({
  bootstrap,
  select,
}: {
  bootstrap: BootstrapData;
  select: (index: number) => void;
}) {
  const [params, setParams] = useSearchParams();
  const teamKey = params.get("team") ?? "AI";
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  function change(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "") next.delete(key);
      else next.set(key, value);
      if (key === "team") {
        next.delete("state");
        next.delete("label");
      }
      return next;
    });
    select(0);
  }
  return (
    <div className="filters">
      <div className="filter-search">
        <Search size={14} />
        <input
          id="issue-search"
          aria-label="Search issues"
          placeholder="Filter issues…"
          value={params.get("q") ?? ""}
          onChange={(e) => {
            change("q", e.target.value);
          }}
        />
      </div>
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
      <FilterMenu
        bootstrap={bootstrap}
        changed={() => {
          select(0);
        }}
      />
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
