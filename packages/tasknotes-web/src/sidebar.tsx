import type { Label, Project } from "@shepherdjerred/facet-protocol";
import type { WorkspaceData } from "./sync.ts";
import {
  activeLabels,
  activeProjects,
  projectDepth,
  swatchColor,
  type Destination,
} from "./workspace.ts";

function sameDestination(left: Destination, right: Destination): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "section" && right.kind === "section") {
    return left.section === right.section;
  }
  return left.kind === "project" && right.kind === "project"
    ? left.id === right.id
    : left.kind === "label" && right.kind === "label" && left.id === right.id;
}

function NavButton(props: {
  current: boolean;
  label: string;
  count?: number;
  depth?: number;
  swatch?: string | undefined;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="nav-button"
        aria-current={props.current ? "page" : undefined}
        style={
          props.depth === undefined
            ? undefined
            : {
                paddingInlineStart: `calc(var(--space-sm) + ${props.depth.toString()} * 12px)`,
              }
        }
        onClick={props.onClick}
      >
        <span className="nav-name">
          {props.swatch === undefined ? null : (
            <span className="swatch" style={{ background: props.swatch }} />
          )}
          {props.label}
        </span>
        {props.count === undefined ? null : (
          <span className="count">{props.count}</span>
        )}
      </button>
    </li>
  );
}

export function SidebarNav(props: {
  data: WorkspaceData;
  destination: Destination;
  inboxCount: number;
  todayCount: number;
  onDestination: (destination: Destination) => void;
}) {
  const projects = activeProjects(props.data.projects).filter(
    (project) => !project.is_inbox,
  );
  const labels = activeLabels(props.data.labels);
  const favorites = [
    ...projects.filter((project) => project.is_favorite),
    ...labels.filter((label) => label.is_favorite),
  ];
  const choose = (destination: Destination) => {
    props.onDestination(destination);
  };
  return (
    <nav aria-label="Workspace">
      <ul className="nav-group">
        <NavButton
          current={sameDestination(props.destination, {
            kind: "section",
            section: "inbox",
          })}
          label="Inbox"
          count={props.inboxCount}
          onClick={() => {
            choose({ kind: "section", section: "inbox" });
          }}
        />
        <NavButton
          current={sameDestination(props.destination, {
            kind: "section",
            section: "today",
          })}
          label="Today"
          count={props.todayCount}
          onClick={() => {
            choose({ kind: "section", section: "today" });
          }}
        />
        <NavButton
          current={sameDestination(props.destination, {
            kind: "section",
            section: "upcoming",
          })}
          label="Upcoming"
          onClick={() => {
            choose({ kind: "section", section: "upcoming" });
          }}
        />
      </ul>
      {favorites.length === 0 ? null : (
        <>
          <p className="nav-label">Favorites</p>
          <ul className="nav-group">
            {projects
              .filter((project) => project.is_favorite)
              .map((project) => (
                <ProjectButton
                  key={`fav-${project.id}`}
                  project={project}
                  data={props.data}
                  destination={props.destination}
                  onChoose={choose}
                />
              ))}
            {labels
              .filter((label) => label.is_favorite)
              .map((label) => (
                <LabelButton
                  key={`fav-${label.id}`}
                  label={label}
                  destination={props.destination}
                  onChoose={choose}
                />
              ))}
          </ul>
        </>
      )}
      <p className="nav-label">Projects</p>
      <ul className="nav-group">
        {projects.map((project) => (
          <ProjectButton
            key={project.id}
            project={project}
            data={props.data}
            destination={props.destination}
            onChoose={choose}
          />
        ))}
      </ul>
      <p className="nav-label">Labels</p>
      <ul className="nav-group">
        {labels.map((label) => (
          <LabelButton
            key={label.id}
            label={label}
            destination={props.destination}
            onChoose={choose}
          />
        ))}
      </ul>
      <p className="nav-label">Browse</p>
      <ul className="nav-group">
        <NavButton
          current={sameDestination(props.destination, {
            kind: "section",
            section: "completed",
          })}
          label="Completed"
          onClick={() => {
            choose({ kind: "section", section: "completed" });
          }}
        />
      </ul>
    </nav>
  );
}

function ProjectButton(props: {
  project: Project;
  data: WorkspaceData;
  destination: Destination;
  onChoose: (destination: Destination) => void;
}) {
  const count = props.data.tasks.filter(
    (task) =>
      !task.is_deleted &&
      !task.completed &&
      (task.parent_id === undefined || task.parent_id === "") &&
      task.project_id === props.project.id,
  ).length;
  return (
    <NavButton
      current={sameDestination(props.destination, {
        kind: "project",
        id: props.project.id,
      })}
      label={props.project.name}
      count={count}
      depth={projectDepth(props.data.projects, props.project)}
      swatch={swatchColor(props.project.color)}
      onClick={() => {
        props.onChoose({ kind: "project", id: props.project.id });
      }}
    />
  );
}

function LabelButton(props: {
  label: Label;
  destination: Destination;
  onChoose: (destination: Destination) => void;
}) {
  return (
    <NavButton
      current={sameDestination(props.destination, {
        kind: "label",
        id: props.label.id,
      })}
      label={`@${props.label.name}`}
      swatch={swatchColor(props.label.color)}
      onClick={() => {
        props.onChoose({ kind: "label", id: props.label.id });
      }}
    />
  );
}
