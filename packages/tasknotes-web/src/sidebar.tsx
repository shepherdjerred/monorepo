import type { Label, Project } from "@shepherdjerred/facet-protocol";
import { useId } from "react";
import { Icon, type IconName } from "./icons.tsx";
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

function NavMark(props: {
  icon: IconName | undefined;
  swatch: string | undefined;
}) {
  if (props.icon === "tag" && props.swatch !== undefined) {
    return (
      <span className="tag-icon" style={{ color: props.swatch }}>
        <Icon name="tag" />
      </span>
    );
  }
  if (props.icon !== undefined) {
    return <Icon name={props.icon} />;
  }
  return props.swatch === undefined ? null : (
    <span className="swatch" style={{ background: props.swatch }} />
  );
}

function NavButton(props: {
  current: boolean;
  label: string;
  count?: number;
  depth?: number;
  swatch?: string | undefined;
  icon?: IconName;
  onClick: () => void;
}) {
  const depth = props.depth ?? 0;
  return (
    <li>
      <button
        type="button"
        className="nav-button"
        aria-current={props.current ? "page" : undefined}
        style={
          depth === 0
            ? undefined
            : {
                paddingInlineStart: `calc(0.5rem + ${depth.toString()} * 0.75rem)`,
              }
        }
        onClick={props.onClick}
      >
        <span className="nav-name">
          <NavMark icon={props.icon} swatch={props.swatch} />
          {props.label}
        </span>
        {props.count === undefined || props.count < 1 ? null : (
          <span className="count">{props.count}</span>
        )}
      </button>
    </li>
  );
}

export function SearchForm(props: {
  className: string;
  value: string;
  onSearch: (value: string) => void;
}) {
  const id = useId();
  return (
    <form
      className={`search ${props.className}`}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label className="visually-hidden" htmlFor={id}>
        Search
      </label>
      <Icon name="search" />
      <input
        id={id}
        type="search"
        placeholder="Search"
        enterKeyHint="search"
        value={props.value}
        onChange={(event) => {
          props.onSearch(event.target.value);
        }}
      />
    </form>
  );
}

export function SidebarFrame(props: {
  data: WorkspaceData;
  destination: Destination;
  inboxCount: number;
  todayCount: number;
  search: string;
  status: string | null;
  error: string | null;
  onDestination: (destination: Destination) => void;
  onSearch: (value: string) => void;
  onCompose: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="sidebar-frame">
      <button type="button" className="add-task" onClick={props.onCompose}>
        <Icon name="plus-circle" />
        Add task
      </button>
      <SearchForm
        className="sidebar-search"
        value={props.search}
        onSearch={props.onSearch}
      />
      <SidebarNav
        data={props.data}
        destination={props.destination}
        inboxCount={props.inboxCount}
        todayCount={props.todayCount}
        onDestination={props.onDestination}
      />
      <footer className="sidebar-footer">
        <span
          className="sync-dot"
          data-state={props.error === null ? "ok" : "error"}
        />
        <span className="sync-label">{props.status ?? "Synced"}</span>
        <button type="button" className="text-button" onClick={props.onSignOut}>
          Sign out
        </button>
      </footer>
    </div>
  );
}

function primarySection(
  destination: Destination,
): "inbox" | "today" | "upcoming" | undefined {
  return destination.kind === "section" && destination.section !== "completed"
    ? destination.section
    : undefined;
}

export function MobileTabBar(props: {
  destination: Destination;
  menuOpen: boolean;
  onDestination: (destination: Destination) => void;
  onBrowse: () => void;
}) {
  const current = primarySection(props.destination);
  const tabs: {
    section: "inbox" | "today" | "upcoming";
    label: string;
    icon: IconName;
  }[] = [
    { section: "inbox", label: "Inbox", icon: "tray" },
    { section: "today", label: "Today", icon: "star" },
    { section: "upcoming", label: "Upcoming", icon: "calendar" },
  ];
  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((tab) => (
        <button
          key={tab.section}
          type="button"
          aria-current={current === tab.section ? "page" : undefined}
          onClick={() => {
            props.onDestination({ kind: "section", section: tab.section });
          }}
        >
          <Icon name={tab.icon} />
          {tab.label}
        </button>
      ))}
      <button
        type="button"
        aria-current={current === undefined ? "page" : undefined}
        aria-expanded={props.menuOpen}
        aria-controls="workspace-menu"
        onClick={props.onBrowse}
      >
        <Icon name="grid" />
        Browse
      </button>
    </nav>
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
          icon="tray"
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
          icon="star"
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
          icon="calendar"
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
          icon="check"
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
      icon="tag"
      label={`@${props.label.name}`}
      swatch={swatchColor(props.label.color)}
      onClick={() => {
        props.onChoose({ kind: "label", id: props.label.id });
      }}
    />
  );
}
