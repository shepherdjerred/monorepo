import { Link, NavLink, useLocation } from "react-router";
import {
  Activity,
  Command,
  Ellipsis,
  Folder,
  Keyboard,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings2,
  Users,
} from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { Modal, Swatch } from "#client/ui/ui.tsx";
import { LiveIndicator } from "#client/live/presence.tsx";
import { rememberTeam } from "./team.ts";

const links = [
  { name: "Issues", path: "/issues", icon: List },
  { name: "Board", path: "/board", icon: LayoutGrid },
  { name: "Projects", path: "/projects", icon: Folder },
  { name: "Actors", path: "/actors", icon: Users },
  { name: "Activity", path: "/activity", icon: Activity },
];
// The phone's bottom bar has room for five; these live behind "More".
const overflow = ["/actors", "/settings"];
export function Sidebar({
  bootstrap,
  teamKey,
  create,
  search,
  help,
}: {
  bootstrap: BootstrapData | undefined;
  teamKey: string | undefined;
  create: () => void;
  search: () => void;
  help: () => void;
}) {
  return (
    <aside className="sidebar">
      <Link className="workspace-brand" to="/issues">
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
        <strong>Tracker</strong>
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
      <div className="sidebar-scroll">
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
              onClick={() => {
                rememberTeam(team.key);
              }}
            >
              <span className="team-icon" aria-hidden="true">
                {team.key}
              </span>
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
                <Swatch color={project.color} />
                {project.name}
              </Link>
            ))}
        </div>
      </div>
      <div className="sidebar-footer">
        <NavLink to="/settings">
          <Settings2 size={16} />
          Settings
        </NavLink>
        <LiveIndicator className="sidebar-live" />
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
export function BottomNavigation({
  more,
  moreOpen,
}: {
  more: () => void;
  moreOpen: boolean;
}) {
  const { pathname } = useLocation();
  const inOverflow = overflow.some((path) => pathname.startsWith(path));
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {links
        .filter(({ path }) => !overflow.includes(path))
        .map((link) => (
          <NavLink key={link.path} to={link.path}>
            <link.icon size={20} />
            <span>{link.name}</span>
          </NavLink>
        ))}
      <button
        className={inOverflow ? "active" : ""}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={more}
      >
        <Ellipsis size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
export function MoreSheet({
  open,
  close,
  help,
}: {
  open: boolean;
  close: () => void;
  help: () => void;
}) {
  return (
    <Modal title="More" open={open} onClose={close} className="sheet">
      <nav className="sheet-links" aria-label="More navigation">
        <NavLink to="/actors" onClick={close}>
          <Users size={18} />
          Actors
        </NavLink>
        <NavLink to="/settings" onClick={close}>
          <Settings2 size={18} />
          Settings
        </NavLink>
        <LiveIndicator className="sidebar-live" />
        <button onClick={help}>
          <Keyboard size={18} />
          Keyboard shortcuts
        </button>
      </nav>
    </Modal>
  );
}
