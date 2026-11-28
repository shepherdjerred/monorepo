import type { Filter, Label, Project } from "@shepherdjerred/facet-protocol";
import { useId, type CSSProperties, type ReactNode } from "react";
import { FacetMark, Icon, type IconName } from "./icons.tsx";
import type { WorkspaceData } from "#sync/sync.ts";
import {
  activeLabels,
  activeProjects,
  projectDepth,
  swatchColor,
  type Destination,
} from "#workspace/workspace.ts";

type Navigation = {
  destination: Destination;
  destinationHref?: ((destination: Destination) => string) | undefined;
  onDestination: (destination: Destination) => void;
};

const primarySections = [
  { section: "inbox", label: "Inbox", icon: "tray" },
  { section: "today", label: "Today", icon: "star" },
  { section: "upcoming", label: "Upcoming", icon: "calendar" },
] as const;

function sameDestination(left: Destination, right: Destination): boolean {
  return left.kind === "section" || right.kind === "section"
    ? left.kind === "section" &&
        right.kind === "section" &&
        left.section === right.section
    : left.kind === right.kind && left.id === right.id;
}

export function WorkspaceLink(props: {
  href?: string | undefined;
  className?: string | undefined;
  current?: boolean | undefined;
  style?: CSSProperties | undefined;
  taskId?: string | undefined;
  children: ReactNode;
  onActivate: () => void;
}) {
  const attributes = {
    "aria-current": props.current === true ? ("page" as const) : undefined,
    "data-task-link": props.taskId,
    className: props.className,
    style: props.style,
  };
  if (props.href === undefined) {
    return (
      <button type="button" {...attributes} onClick={props.onActivate}>
        {props.children}
      </button>
    );
  }
  return (
    <a
      href={props.href}
      {...attributes}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        event.preventDefault();
        props.onActivate();
      }}
    >
      {props.children}
    </a>
  );
}

function NavMark(props: {
  icon: IconName | undefined;
  swatch: string | undefined;
}) {
  if (props.icon !== undefined) {
    return (
      <span className="nav-icon" style={{ color: props.swatch }}>
        <Icon name={props.icon} />
      </span>
    );
  }
  return <span className="swatch" style={{ backgroundColor: props.swatch }} />;
}

function NavItem(
  props: Navigation & {
    target: Destination;
    label: string;
    count?: number | undefined;
    depth?: number | undefined;
    swatch?: string | undefined;
    icon?: IconName | undefined;
  },
) {
  return (
    <li>
      <WorkspaceLink
        className="nav-button"
        current={sameDestination(props.destination, props.target)}
        href={props.destinationHref?.(props.target)}
        style={
          props.depth === undefined || props.depth === 0
            ? undefined
            : {
                paddingInlineStart: `calc(0.75rem + ${props.depth.toString()} * 0.75rem)`,
              }
        }
        onActivate={() => {
          props.onDestination(props.target);
        }}
      >
        <NavMark icon={props.icon} swatch={props.swatch} />
        <span className="nav-name">{props.label}</span>
        {props.count === undefined || props.count < 1 ? null : (
          <span className="count">{props.count}</span>
        )}
      </WorkspaceLink>
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
        Search tasks
      </label>
      <Icon name="search" />
      <input
        id={id}
        name="q"
        type="search"
        placeholder="Search tasks"
        enterKeyHint="search"
        autoComplete="off"
        value={props.value}
        onChange={(event) => {
          props.onSearch(event.target.value);
        }}
      />
    </form>
  );
}

export function SearchLauncher(props: {
  className: string;
  onOpen: () => void;
}) {
  return (
    <button
      className={`search search-launcher ${props.className}`}
      type="button"
      onClick={props.onOpen}
    >
      <Icon name="search" />
      <span>Search</span>
    </button>
  );
}

export function SidebarFrame(
  props: Navigation & {
    data: WorkspaceData;
    inboxCount: number;
    todayCount: number;
    search: string;
    status: string | null;
    error: string | null;
    canWrite: boolean;
    onSearch: (value: string) => void;
    onOpenSearch?: (() => void) | undefined;
    onCompose: () => void;
    onSignOut: () => void;
    extraNavigation?: ReactNode;
  },
) {
  return (
    <div className="sidebar-frame">
      <div className="sidebar-brand">
        <FacetMark />
        <span>Facet</span>
      </div>
      <div className="sidebar-actions">
        {props.canWrite ? (
          <button
            type="button"
            className="primary add-task"
            onClick={props.onCompose}
          >
            <Icon name="plus" />
            Add task
          </button>
        ) : null}
        {props.onOpenSearch === undefined ? (
          <SearchForm
            className="sidebar-search"
            value={props.search}
            onSearch={props.onSearch}
          />
        ) : (
          <SearchLauncher
            className="sidebar-search"
            onOpen={props.onOpenSearch}
          />
        )}
      </div>
      <SidebarNav {...props} />
      <WorkspaceFooter
        status={props.status}
        error={props.error}
        onSignOut={props.onSignOut}
      />
    </div>
  );
}

export function WorkspaceFooter(props: {
  status: string | null;
  error: string | null;
  onSignOut: () => void;
}) {
  return (
    <footer className="sidebar-footer">
      {props.status === null ? null : (
        <div className="sync-status">
          <span
            className="sync-dot"
            data-state={props.error === null ? "ok" : "error"}
            aria-hidden="true"
          />
          <span>{props.status}</span>
        </div>
      )}
      <button type="button" className="text-button" onClick={props.onSignOut}>
        Sign out
      </button>
    </footer>
  );
}

export function MobileTabBar(
  props: Navigation & {
    browseActive: boolean;
    browseHref?: string | undefined;
    onBrowse: () => void;
  },
) {
  const current =
    !props.browseActive && props.destination.kind === "section"
      ? props.destination.section
      : undefined;
  return (
    <nav className="tabbar" aria-label="Sections">
      {primarySections.map((tab) => {
        const target = { kind: "section", section: tab.section } as const;
        return (
          <WorkspaceLink
            key={tab.section}
            current={current === tab.section}
            href={props.destinationHref?.(target)}
            onActivate={() => {
              props.onDestination(target);
            }}
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
          </WorkspaceLink>
        );
      })}
      <WorkspaceLink
        current={current === undefined || current === "completed"}
        href={props.browseHref}
        onActivate={props.onBrowse}
      >
        <Icon name="grid" />
        <span>Browse</span>
      </WorkspaceLink>
    </nav>
  );
}

export function SidebarNav(
  props: Navigation & {
    data: WorkspaceData;
    inboxCount: number;
    todayCount: number;
    collectionsOnly?: boolean;
    extraNavigation?: ReactNode;
  },
) {
  const projects = activeProjects(props.data.projects).filter(
    (project) => !project.is_inbox,
  );
  const labels = activeLabels(props.data.labels);
  const filters = props.data.filters.filter((filter) => !filter.is_deleted);
  const favoriteProjects = projects.filter((project) => project.is_favorite);
  const favoriteLabels = labels.filter((label) => label.is_favorite);
  const favoriteFilters = filters.filter((filter) => filter.is_favorite);
  const projectCounts = new Map<string, number>();
  for (const task of props.data.tasks) {
    if (!task.is_deleted && !task.completed && (task.parent_id ?? "") === "") {
      projectCounts.set(
        task.project_id,
        (projectCounts.get(task.project_id) ?? 0) + 1,
      );
    }
  }
  const projectItem = (project: Project) => (
    <NavItem
      key={project.id}
      {...props}
      target={{ kind: "project", id: project.id }}
      label={project.name}
      count={projectCounts.get(project.id)}
      depth={projectDepth(props.data.projects, project)}
      icon="folder"
      swatch={swatchColor(project.color)}
    />
  );
  const labelItem = (label: Label) => (
    <NavItem
      key={label.id}
      {...props}
      target={{ kind: "label", id: label.id }}
      label={label.name}
      icon="tag"
      swatch={swatchColor(label.color)}
    />
  );
  const filterItem = (filter: Filter) => (
    <NavItem
      key={filter.id}
      {...props}
      target={{ kind: "filter", id: filter.id }}
      label={filter.name}
      icon="filter"
      swatch={swatchColor(filter.color)}
    />
  );

  return (
    <nav
      className="sidebar-nav"
      aria-label={props.collectionsOnly === true ? "Collections" : "Workspace"}
    >
      {props.collectionsOnly === true ? null : (
        <ul className="nav-group nav-primary">
          {primarySections.map((tab) => (
            <NavItem
              key={tab.section}
              {...props}
              label={tab.label}
              icon={tab.icon}
              target={{ kind: "section", section: tab.section }}
              count={
                tab.section === "inbox"
                  ? props.inboxCount
                  : tab.section === "today"
                    ? props.todayCount
                    : undefined
              }
            />
          ))}
        </ul>
      )}
      {favoriteProjects.length +
        favoriteLabels.length +
        favoriteFilters.length ===
      0 ? null : (
        <div className="nav-collection">
          <p className="nav-label">Favorites</p>
          <ul className="nav-group">
            {favoriteProjects.map((project) => projectItem(project))}
            {favoriteLabels.map((label) => labelItem(label))}
            {favoriteFilters.map((filter) => filterItem(filter))}
          </ul>
        </div>
      )}
      {projects.length === 0 ? null : (
        <div className="nav-collection">
          <p className="nav-label">Projects</p>
          <ul className="nav-group">
            {projects.map((project) => projectItem(project))}
          </ul>
        </div>
      )}
      {labels.length === 0 ? null : (
        <div className="nav-collection">
          <p className="nav-label">Labels</p>
          <ul className="nav-group">
            {labels.map((label) => labelItem(label))}
          </ul>
        </div>
      )}
      {filters.length === 0 ? null : (
        <div className="nav-collection">
          <p className="nav-label">Filters</p>
          <ul className="nav-group">
            {filters.map((filter) => filterItem(filter))}
          </ul>
        </div>
      )}
      <ul className="nav-group nav-completed">
        <NavItem
          {...props}
          target={{ kind: "section", section: "completed" }}
          icon="check"
          label="Completed"
        />
      </ul>
      {props.extraNavigation}
    </nav>
  );
}
