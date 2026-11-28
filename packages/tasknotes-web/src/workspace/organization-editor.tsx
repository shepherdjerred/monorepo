import type {
  Filter,
  Label,
  Project,
  Section,
  SyncCommand,
} from "@shepherdjerred/facet-protocol";
import { useState } from "react";
import type { CivilDay } from "./civil-day.ts";
import { parseSavedFilter } from "./saved-filter.ts";
import type { WorkspaceData } from "#sync/sync.ts";
import type { CommandHandler } from "./workspace-commands.ts";
import { activeProjects, inactiveProjectIds } from "./workspace.ts";

export type Entity =
  | { kind: "project"; value?: Project }
  | { kind: "label"; value?: Label }
  | { kind: "filter"; value?: Filter }
  | { kind: "section"; projectId: string; value?: Section };

const colorSwatches = [
  "charcoal",
  "berry_red",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "grape",
  "magenta",
  "salmon",
  "grey",
];

function sourceColor(entity: Entity): string {
  return entity.kind === "section" ? "" : (entity.value?.color ?? "grey");
}

function sourceFavorite(entity: Entity): boolean {
  return entity.kind !== "section" && entity.value?.is_favorite === true;
}

function canBeProjectParent(
  project: Project,
  projectId: string | undefined,
  projects: Project[],
): boolean {
  const seen = new Set<string>();
  let current: Project | undefined = project;
  while (current !== undefined) {
    if (current.id === projectId || seen.has(current.id)) return false;
    seen.add(current.id);
    const parent: string | undefined = current.parent_id;
    current =
      parent === undefined || parent === ""
        ? undefined
        : projects.find((value) => value.id === parent);
  }
  return !project.is_inbox;
}

type EntityDraft = {
  name: string;
  color: string;
  favorite: boolean;
  parent: string;
  query: string;
};

function initialEntityDraft(entity: Entity): EntityDraft {
  return {
    name: entity.value?.name ?? "",
    color: sourceColor(entity),
    favorite: sourceFavorite(entity),
    parent: entity.kind === "project" ? (entity.value?.parent_id ?? "") : "",
    query: entity.kind === "filter" ? (entity.value?.query ?? "") : "",
  };
}

function entityCommand(
  entity: Entity,
  { name, color, favorite, parent, query }: EntityDraft,
): SyncCommand {
  const common = { name, color, is_favorite: favorite };
  switch (entity.kind) {
    case "project":
      return entity.value === undefined
        ? {
            type: "ProjectAdd",
            args: {
              ...common,
              ...(parent === "" ? {} : { parent_id: parent }),
            },
          }
        : {
            type: "ProjectUpdate",
            args: { ...common, id: entity.value.id, parent_id: parent },
          };
    case "section":
      return entity.value === undefined
        ? { type: "SectionAdd", args: { name, project_id: entity.projectId } }
        : { type: "SectionUpdate", args: { name, id: entity.value.id } };
    case "label":
      return entity.value === undefined
        ? { type: "LabelAdd", args: common }
        : { type: "LabelUpdate", args: { ...common, id: entity.value.id } };
    case "filter":
      return entity.value === undefined
        ? { type: "FilterAdd", args: { ...common, query } }
        : {
            type: "FilterUpdate",
            args: { ...common, id: entity.value.id, query },
          };
  }
}

function filterPreview(
  query: string,
  data: WorkspaceData,
  today: CivilDay,
  timeZone: string,
) {
  if (query.trim() === "") return { count: 0, error: "" };
  try {
    const filter = parseSavedFilter(query);
    const inactive = inactiveProjectIds(data.projects);
    const count = data.tasks.filter(
      (task) =>
        !task.is_deleted &&
        (task.parent_id ?? "") === "" &&
        !inactive.has(task.project_id) &&
        (filter.includesCompleted || !task.completed) &&
        filter.matches(task, { data, today, timeZone }),
    ).length;
    return { count, error: "" };
  } catch (error) {
    return {
      count: 0,
      error:
        error instanceof Error
          ? error.message
          : "This filter couldn’t be read.",
    };
  }
}

export function EntityEditor({
  entity,
  data,
  today,
  timeZone,
  onCommand,
  onClose,
}: {
  entity: Entity;
  data: WorkspaceData;
  today: CivilDay;
  timeZone: string;
  onCommand: CommandHandler;
  onClose: () => void;
}) {
  const initial = initialEntityDraft(entity);
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [parent, setParent] = useState(initial.parent);
  const [favorite, setFavorite] = useState(initial.favorite);
  const [query, setQuery] = useState(initial.query);
  const [busy, setBusy] = useState(false);
  const projects = activeProjects(data.projects);
  const { count, error } = filterPreview(query, data, today, timeZone);
  const disabled =
    busy ||
    error !== "" ||
    name.trim() === "" ||
    (entity.kind === "filter" && query.trim() === "");

  async function save() {
    if (disabled) return;
    setBusy(true);
    try {
      const command = entityCommand(entity, {
        name: name.trim(),
        color,
        favorite,
        parent,
        query: query.trim(),
      });
      const notice =
        entity.value === undefined
          ? `Added ${entity.kind}`
          : `Updated ${entity.kind}`;
      const accepted = await onCommand(
        command,
        entity.value === undefined
          ? { tempId: `tmp-${crypto.randomUUID()}`, notice }
          : { notice },
      );
      if (accepted) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="feature-form feature-card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>
        {entity.value === undefined
          ? `New ${entity.kind}`
          : `Edit ${entity.kind}`}
      </h2>
      <label>
        Name
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          required
        />
      </label>
      {entity.kind === "project" ? (
        <label>
          Parent project
          <select
            value={parent}
            onChange={(event) => {
              setParent(event.target.value);
            }}
          >
            <option value="">No parent project</option>
            {projects
              .filter((project) =>
                canBeProjectParent(project, entity.value?.id, projects),
              )
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {entity.kind === "section" ? null : (
        <div className="feature-fields">
          <label>
            Color
            <select
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
              }}
            >
              {colorSwatches.includes(color) ? null : (
                <option value={color}>Current color</option>
              )}
              {colorSwatches.map((swatch) => (
                <option key={swatch} value={swatch}>
                  {swatch.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="feature-check">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(event) => {
                setFavorite(event.target.checked);
              }}
            />{" "}
            Add to favorites
          </label>
        </div>
      )}
      {entity.kind === "filter" ? (
        <>
          <label>
            Filter query
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              aria-invalid={error !== ""}
              required
              placeholder="(today | overdue) & #Work…"
            />
          </label>
          <p className={error === "" ? "feature-note" : "alert"} role="status">
            {error ||
              `${count.toString()} matching ${count === 1 ? "task" : "tasks"}`}
          </p>
        </>
      ) : null}
      <div className="feature-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={disabled}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
