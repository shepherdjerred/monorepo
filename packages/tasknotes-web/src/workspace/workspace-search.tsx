import type { Task } from "@shepherdjerred/facet-protocol";
import { WorkspaceLink } from "#ui/sidebar.tsx";
import type { WorkspaceData } from "#sync/sync.ts";
import { workspaceSearch, type Destination } from "./workspace.ts";
import "./workspace-features.css";

type SearchProps = {
  data: WorkspaceData;
  query: string;
  includeCompleted: boolean;
  onQuery: (query: string) => void;
  onIncludeCompleted: (value: boolean) => void;
  onOpenTask: (task: Task) => void;
  onDestination: (destination: Destination) => void;
  taskHref?: (task: Task) => string;
  destinationHref?: (destination: Destination) => string;
};

export function WorkspaceSearch(props: SearchProps) {
  const results = workspaceSearch(
    props.data,
    props.query,
    props.includeCompleted,
  );
  const projects = new Map(
    props.data.projects.map((project) => [project.id, project.name]),
  );
  const collections: {
    label: string;
    items: { id: string; name: string; destination: Destination }[];
  }[] = [
    {
      label: "Projects",
      items: results.projects.map((item) => ({
        ...item,
        destination: item.is_inbox
          ? { kind: "section", section: "inbox" }
          : { kind: "project", id: item.id },
      })),
    },
    {
      label: "Labels",
      items: results.labels.map((item) => ({
        ...item,
        destination: { kind: "label", id: item.id },
      })),
    },
    {
      label: "Filters",
      items: results.filters.map((item) => ({
        ...item,
        destination: { kind: "filter", id: item.id },
      })),
    },
  ];
  const count =
    results.tasks.length +
    collections.reduce((sum, collection) => sum + collection.items.length, 0);
  return (
    <div className="feature-search">
      <form
        className="feature-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const [task] = results.tasks;
          const firstCollection = collections.find(
            (collection) => collection.items.length > 0,
          )?.items[0];
          if (task !== undefined) props.onOpenTask(task);
          else if (firstCollection !== undefined)
            props.onDestination(firstCollection.destination);
        }}
      >
        <label>
          Search the workspace
          <input
            type="search"
            value={props.query}
            onChange={(event) => {
              props.onQuery(event.target.value);
            }}
            enterKeyHint="search"
            placeholder="Tasks, notes, projects, and filters…"
          />
        </label>
        <label className="feature-check">
          <input
            type="checkbox"
            checked={props.includeCompleted}
            onChange={(event) => {
              props.onIncludeCompleted(event.target.checked);
            }}
          />{" "}
          Include completed tasks
        </label>
      </form>
      {props.query.trim() === "" || count > 0 ? null : (
        <p className="feature-note" role="status">
          No results for “{props.query.trim()}”.
        </p>
      )}
      {results.tasks.length === 0 ? null : (
        <section className="feature-results">
          <h2>Tasks</h2>
          <ul>
            {results.tasks.map((task) => (
              <li key={task.id}>
                <WorkspaceLink
                  href={props.taskHref?.(task)}
                  taskId={task.id}
                  onActivate={() => {
                    props.onOpenTask(task);
                  }}
                >
                  <span
                    className={task.completed ? "feature-completed" : undefined}
                  >
                    {task.title}
                  </span>
                  <small>{projects.get(task.project_id) ?? "Inbox"}</small>
                </WorkspaceLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      {collections.map((collection) =>
        collection.items.length === 0 ? null : (
          <section className="feature-results" key={collection.label}>
            <h2>{collection.label}</h2>
            <ul>
              {collection.items.map((item) => (
                <li key={item.id}>
                  <WorkspaceLink
                    href={props.destinationHref?.(item.destination)}
                    onActivate={() => {
                      props.onDestination(item.destination);
                    }}
                  >
                    {item.name}
                  </WorkspaceLink>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
