import { Link, NavLink } from "react-router";
import {
  Activity,
  ChevronDown,
  Command,
  Folder,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings2,
  Users,
} from "lucide-react";
import type { BootstrapData } from "./api.ts";

const links = [
  { name: "Issues", path: "/issues", icon: List },
  { name: "Board", path: "/board", icon: LayoutGrid },
  { name: "Projects", path: "/projects", icon: Folder },
  { name: "Actors", path: "/actors", icon: Users },
  { name: "Activity", path: "/activity", icon: Activity },
];
export function Sidebar({
  bootstrap,
  teamKey,
  create,
  search,
  help,
}: {
  bootstrap: BootstrapData | undefined;
  teamKey: string;
  create: () => void;
  search: () => void;
  help: () => void;
}) {
  return (
    <aside className="sidebar">
      <Link className="workspace-brand" to="/issues">
        <span className="brand-mark">T</span>
        <strong>Tracker</strong>
        <ChevronDown size={14} />
      </Link>
      <button className="search-command" onClick={search}>
        <Search size={15} />
        <span>Search anything</span>
        <kbd>⌘ K</kbd>
      </button>
      <button
        className="new-issue"
        onClick={create}
        disabled={bootstrap?.writesEnabled !== true}
      >
        <Plus size={16} />
        New issue<kbd>C</kbd>
      </button>
      <p className="nav-heading">Workspace</p>
      <nav aria-label="Main navigation">
        {links.map((link) => (
          <NavLink key={link.path} to={link.path}>
            <link.icon size={16} />
            <span>{link.name}</span>
          </NavLink>
        ))}
      </nav>
      <p className="nav-heading">Teams</p>
      <div className="team-nav">
        {bootstrap?.teams.map((team) => (
          <Link
            key={team.id}
            to={`/issues?team=${team.key}`}
            className={teamKey === team.key ? "active-team" : ""}
          >
            <span className="team-icon">{team.key}</span>
            <span>{team.name}</span>
          </Link>
        ))}
      </div>
      <p className="nav-heading">Projects</p>
      <div className="project-nav">
        {bootstrap?.projects
          .filter(({ archivedAt }) => archivedAt === null)
          .map((project) => (
            <Link to={`/projects/${project.slug}`} key={project.id}>
              <i style={{ background: project.color }} />
              {project.name}
            </Link>
          ))}
      </div>
      <div className="sidebar-footer">
        <NavLink to="/settings">
          <Settings2 size={16} />
          Settings
        </NavLink>
        <button
          className="icon-button"
          onClick={help}
          aria-label="Keyboard shortcuts"
        >
          <Command size={15} />
        </button>
      </div>
    </aside>
  );
}
export function BottomNavigation() {
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {links
        .filter(({ name }) => name !== "Actors")
        .map((link) => (
          <NavLink key={link.path} to={link.path}>
            <link.icon size={20} />
            <span>{link.name}</span>
          </NavLink>
        ))}
    </nav>
  );
}
