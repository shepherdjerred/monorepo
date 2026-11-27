import type { Project, SyncCommand } from "@shepherdjerred/facet-protocol";
import { useState } from "react";
import type { CivilDay } from "./civil-day.ts";
import { EntityEditor, type Entity } from "./organization-editor.tsx";
import type { WorkspaceData } from "#sync/sync.ts";
import { BatchMove, ProjectTaskOrdering } from "./project-bulk-move.tsx";
import type { CommandHandler } from "./workspace-commands.ts";
import {
  activeFilters,
  activeLabels,
  activeProjects,
  defaultProjectPreferences,
  projectDepth,
  sectionsIn,
  type Destination,
  type ProjectPreferences,
} from "./workspace.ts";
import "./workspace-features.css";

type OrganizationProps = {
  data: WorkspaceData;
  destination: Destination;
  onCommand: CommandHandler;
  preferences?: ProjectPreferences;
  onPreferences?: (preferences: ProjectPreferences) => void;
  today: CivilDay;
  timeZone: string;
  canWrite?: boolean;
};

type DisplayProps = {
  preferences: ProjectPreferences;
  onPreferences: (preferences: ProjectPreferences) => void;
};

function ProjectLayout({ preferences, onPreferences }: DisplayProps) {
  return (
    <label className="feature-layout">
      Layout
      <select
        value={preferences.layout}
        onChange={(event) => {
          onPreferences({
            ...preferences,
            layout: event.target.value === "board" ? "board" : "list",
          });
        }}
      >
        <option value="list">List</option>
        <option value="board">Board</option>
      </select>
    </label>
  );
}

function ProjectDisplay({
  preferences,
  onPreferences,
}: {
  preferences: ProjectPreferences;
  onPreferences: (preferences: ProjectPreferences) => void;
}) {
  return (
    <div className="feature-fields" aria-label="Project display">
      <label>
        Group by
        <select
          value={preferences.grouping}
          onChange={(event) => {
            onPreferences({
              ...preferences,
              grouping:
                event.target.value === "priority" ? "priority" : "section",
            });
          }}
        >
          <option value="section">Section</option>
          <option value="priority">Priority</option>
        </select>
      </label>
      <label>
        Sort by
        <select
          value={preferences.sort}
          onChange={(event) => {
            const sort = event.target.value;
            if (sort === "manual" || sort === "title" || sort === "priority")
              onPreferences({ ...preferences, sort });
          }}
        >
          <option value="manual">Manual order</option>
          <option value="title">Title</option>
          <option value="priority">Priority</option>
        </select>
      </label>
    </div>
  );
}

function currentEntity(
  data: WorkspaceData,
  destination: Destination,
): Entity | undefined {
  switch (destination.kind) {
    case "project": {
      const value = activeProjects(data.projects).find(
        (item) => item.id === destination.id && !item.is_inbox,
      );
      return value === undefined ? undefined : { kind: "project", value };
    }
    case "label": {
      const value = activeLabels(data.labels).find(
        (item) => item.id === destination.id,
      );
      return value === undefined ? undefined : { kind: "label", value };
    }
    case "filter": {
      const value = activeFilters(data.filters).find(
        (item) => item.id === destination.id,
      );
      return value === undefined ? undefined : { kind: "filter", value };
    }
    case "section":
      return undefined;
  }
}

function deleteCommand(entity: Entity): SyncCommand | undefined {
  const id = entity.value?.id;
  if (id === undefined) return undefined;
  switch (entity.kind) {
    case "project":
      return { type: "ProjectDelete", args: { id } };
    case "section":
      return { type: "SectionDelete", args: { id } };
    case "label":
      return { type: "LabelDelete", args: { id } };
    case "filter":
      return { type: "FilterDelete", args: { id } };
  }
}

function ProjectSections({
  data,
  project,
  onCommand,
  onEdit,
  onRemove,
  canReorder,
}: {
  data: WorkspaceData;
  project: Project;
  onCommand: CommandHandler;
  onEdit: (entity: Entity) => void;
  onRemove: (entity: Entity) => void;
  canReorder: boolean;
}) {
  const sections = sectionsIn(data, project.id);
  return (
    <>
      <div className="feature-management">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            onEdit({ kind: "section", projectId: project.id });
          }}
        >
          New section
        </button>
        {sections.map((section) => (
          <div key={section.id} className="feature-chips">
            <strong>{section.name}</strong>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                onEdit({
                  kind: "section",
                  projectId: project.id,
                  value: section,
                });
              }}
            >
              Rename
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                onRemove({
                  kind: "section",
                  projectId: project.id,
                  value: section,
                });
              }}
            >
              Delete section
            </button>
          </div>
        ))}
      </div>
      <BatchMove
        key={project.id}
        data={data}
        project={project}
        onCommand={onCommand}
      />
      {canReorder ? (
        <ProjectTaskOrdering
          data={data}
          projectId={project.id}
          onCommand={onCommand}
        />
      ) : null}
    </>
  );
}

function ArchivedProjects({
  projects,
  onRestore,
}: {
  projects: Project[];
  onRestore: (project: Project) => void;
}) {
  const archived = projects.filter(
    (project) => project.is_archived && !project.is_deleted,
  );
  if (archived.length === 0) return null;
  return (
    <details className="feature-disclosure">
      <summary>Archived projects</summary>
      <ul className="feature-item-list">
        {archived.map((item) => (
          <li
            key={item.id}
            style={{
              marginInlineStart: `${projectDepth(projects, item).toString()}rem`,
            }}
          >
            <span>{item.name}</span>{" "}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onRestore(item);
              }}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function EntityActions({
  entity,
  onEdit,
  onArchive,
  onRemove,
}: {
  entity: Entity;
  onEdit: () => void;
  onArchive?: (() => void) | undefined;
  onRemove: () => void;
}) {
  return (
    <div className="feature-chips">
      <button type="button" className="secondary" onClick={onEdit}>
        Edit {entity.kind}
      </button>
      {onArchive === undefined ? null : (
        <button type="button" className="secondary" onClick={onArchive}>
          Archive project
        </button>
      )}
      <button className="danger" type="button" onClick={onRemove}>
        Delete {entity.kind}
      </button>
    </div>
  );
}

function OrganizationEdits(
  props: Pick<
    OrganizationProps,
    "data" | "today" | "timeZone" | "onCommand"
  > & {
    current: Entity | undefined;
    project: Project | undefined;
    canReorder: boolean;
  },
) {
  const [edit, setEdit] = useState<Entity>();
  const [remove, setRemove] = useState<Entity>();
  const [pending, setPending] = useState(false);
  const { current, project } = props;

  function archive(item: Project, value: boolean) {
    void props.onCommand(
      { type: "ProjectUpdate", args: { id: item.id, is_archived: value } },
      { notice: value ? "Archived project" : "Restored project" },
    );
  }

  async function confirmDelete(entity: Entity) {
    if (pending) return;
    const command = deleteCommand(entity);
    if (command === undefined) return;
    setPending(true);
    try {
      if (await props.onCommand(command, { notice: `Deleted ${entity.kind}` }))
        setRemove(undefined);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="feature-chips">
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setEdit({ kind: "project" });
          }}
        >
          New project
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setEdit({ kind: "label" });
          }}
        >
          New label
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setEdit({ kind: "filter" });
          }}
        >
          New filter
        </button>
      </div>
      {current === undefined ? null : (
        <EntityActions
          entity={current}
          onEdit={() => {
            setEdit(current);
          }}
          onArchive={
            project === undefined
              ? undefined
              : () => {
                  archive(project, true);
                }
          }
          onRemove={() => {
            setRemove(current);
          }}
        />
      )}
      {edit === undefined ? null : (
        <EntityEditor
          key={`${edit.kind}-${edit.value?.id ?? "new"}`}
          entity={edit}
          data={props.data}
          today={props.today}
          timeZone={props.timeZone}
          onCommand={props.onCommand}
          onClose={() => {
            setEdit(undefined);
          }}
        />
      )}
      {remove === undefined ? null : (
        <div className="feature-card feature-form">
          <p>Delete {remove.value?.name}?</p>
          <div className="feature-chips">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setRemove(undefined);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              disabled={pending}
              onClick={() => void confirmDelete(remove)}
            >
              Confirm delete
            </button>
          </div>
        </div>
      )}
      {project === undefined ? null : (
        <ProjectSections
          data={props.data}
          project={project}
          onCommand={props.onCommand}
          onEdit={setEdit}
          onRemove={setRemove}
          canReorder={props.canReorder}
        />
      )}
      <ArchivedProjects
        projects={props.data.projects}
        onRestore={(item) => {
          archive(item, false);
        }}
      />
    </>
  );
}

export function OrganizationTools(props: OrganizationProps) {
  const current = currentEntity(props.data, props.destination);
  const project = current?.kind === "project" ? current.value : undefined;
  const canWrite = props.canWrite !== false;
  if (!canWrite && (project === undefined || props.onPreferences === undefined))
    return null;

  const display =
    project === undefined || props.onPreferences === undefined
      ? null
      : {
          preferences: props.preferences ?? defaultProjectPreferences,
          onPreferences: props.onPreferences,
        };
  return (
    <div className="feature-organizer">
      {display === null ? null : <ProjectLayout {...display} />}
      <details className="feature-disclosure feature-management-controls">
        <summary>
          {project === undefined ? "Manage workspace" : "Project options"}
        </summary>
        <div className="feature-management">
          {display === null ? null : <ProjectDisplay {...display} />}
          {canWrite ? (
            <OrganizationEdits
              data={props.data}
              today={props.today}
              timeZone={props.timeZone}
              onCommand={props.onCommand}
              current={current}
              project={project}
              canReorder={
                display?.preferences.grouping === "section" &&
                display.preferences.sort === "manual"
              }
            />
          ) : null}
        </div>
      </details>
    </div>
  );
}
