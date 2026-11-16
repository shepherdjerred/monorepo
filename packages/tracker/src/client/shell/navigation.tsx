import { useState } from "react";
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
  MessagesSquare,
} from "lucide-react";
import { ActorSchema, type ActorEnvelope } from "#shared/actor.ts";
import type { BootstrapData } from "#client/data/api.ts";
import {
  clearSavedActor,
  hasSavedActor,
  saveActor,
  useCurrentActor,
} from "#client/data/identity.ts";
import {
  ActorChip,
  Avatar,
  ErrorNotice,
  Modal,
  Swatch,
} from "#client/ui/ui.tsx";
import { notify } from "#client/ui/toast.tsx";
import { LiveIndicator } from "#client/live/presence.tsx";
import { rememberTeam } from "./team.ts";
import { ViewsNav } from "#client/saved-views/views-nav.tsx";

const links = [
  { name: "Issues", path: "/issues", icon: List },
  { name: "Board", path: "/board", icon: LayoutGrid },
  { name: "Forum", path: "/forum", icon: MessagesSquare },
  { name: "Projects", path: "/projects", icon: Folder },
  { name: "Actors", path: "/actors", icon: Users },
  { name: "Activity", path: "/activity", icon: Activity },
];
// The phone's bottom bar has room for five; these live behind "More".
const overflow = ["/actors", "/settings", "/forum"];
export function Sidebar({
  bootstrap,
  teamKey,
  create,
  search,
  help,
  identity,
}: {
  bootstrap: BootstrapData | undefined;
  teamKey: string | undefined;
  create: () => void;
  search: () => void;
  help: () => void;
  identity: () => void;
}) {
  const actor = useCurrentActor();
  return (
    <aside className="sidebar">
      <Link className="workspace-brand" to="/issues">
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
        <strong>Tracker</strong>
      </Link>
      <button type="button" className="search-command" onClick={search}>
        <Search size={15} />
        <span>Search anything</span>
        <kbd>⌘ K</kbd>
      </button>
      <button
        type="button"
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
        {bootstrap !== undefined && teamKey !== undefined && (
          <ViewsNav bootstrap={bootstrap} teamKey={teamKey} />
        )}
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
        <button
          type="button"
          className="identity-button"
          aria-haspopup="dialog"
          onClick={identity}
        >
          <Avatar actor={actor} decorative />
          <span className="identity-label">
            <span className="sr-only">Acting as </span>
            {actor.name}
          </span>
        </button>
        <div className="sidebar-footer-links">
          <NavLink to="/settings">
            <Settings2 size={16} />
            Settings
          </NavLink>
          <LiveIndicator className="sidebar-live" />
          <button
            type="button"
            className="icon-button"
            onClick={help}
            aria-label="Keyboard shortcuts"
          >
            <Command size={15} />
          </button>
        </div>
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
        type="button"
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
  bootstrap,
  teamKey,
  open,
  close,
  help,
  identity,
}: {
  bootstrap: BootstrapData | undefined;
  teamKey: string | undefined;
  open: boolean;
  close: () => void;
  help: () => void;
  identity: () => void;
}) {
  const actor = useCurrentActor();
  return (
    <Modal title="More" open={open} onClose={close} className="sheet">
      {bootstrap !== undefined && teamKey !== undefined && (
        <div className="sheet-views">
          <ViewsNav
            bootstrap={bootstrap}
            teamKey={teamKey}
            onNavigate={close}
          />
        </div>
      )}
      <nav className="sheet-links" aria-label="More navigation">
        <button type="button" aria-haspopup="dialog" onClick={identity}>
          <Avatar actor={actor} decorative />
          <span>Acting as {actor.name}</span>
        </button>
        <NavLink to="/forum" onClick={close}>
          <MessagesSquare size={18} />
          Forum
        </NavLink>
        <NavLink to="/actors" onClick={close}>
          <Users size={18} />
          Actors
        </NavLink>
        <NavLink to="/settings" onClick={close}>
          <Settings2 size={18} />
          Settings
        </NavLink>
        <LiveIndicator className="sidebar-live" />
        <button type="button" onClick={help}>
          <Keyboard size={18} />
          Keyboard shortcuts
        </button>
      </nav>
    </Modal>
  );
}

function IdentityCustomForm({
  actor,
  onSaved,
}: {
  actor: ActorEnvelope;
  onSaved: () => void;
}) {
  const [name, setName] = useState(actor.name);
  const [key, setKey] = useState(actor.key);
  const [kind, setKind] = useState<ActorEnvelope["kind"]>(actor.kind);
  const [error, setError] = useState<unknown>();
  return (
    <form
      className="identity-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          saveActor(ActorSchema.parse({ key, name, kind }));
          setError(undefined);
          notify("Identity saved");
          onSaved();
        } catch (error_) {
          setError(error_);
        }
      }}
    >
      <div className="form-selects">
        <label htmlFor="identity-modal-name">
          Name
          <input
            id="identity-modal-name"
            value={name}
            required
            onChange={(event) => {
              setName(event.target.value);
              if (error !== undefined) {
                setError(undefined);
              }
            }}
          />
        </label>
        <label htmlFor="identity-modal-kind">
          Kind
          <select
            id="identity-modal-kind"
            value={kind}
            onChange={(event) => {
              setKind(ActorSchema.shape.kind.parse(event.target.value));
              if (error !== undefined) {
                setError(undefined);
              }
            }}
          >
            {ActorSchema.shape.kind.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor="identity-modal-key">
        Actor key
        <input
          id="identity-modal-key"
          value={key}
          required
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => {
            setKey(event.target.value);
            if (error !== undefined) {
              setError(undefined);
            }
          }}
        />
      </label>
      {error !== undefined && <ErrorNotice error={error} />}
      <div className="modal-footer">
        <span className="muted">Saved to this browser profile</span>
        <button type="submit" className="primary">
          Save identity
        </button>
      </div>
    </form>
  );
}

export function IdentityModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const actor = useCurrentActor();
  const saved = hasSavedActor();
  const isJerred = actor.key === "human:jerred" && actor.kind === "human";
  return (
    <Modal
      title="Browser identity"
      open={open}
      onClose={onClose}
      className="identity-modal"
    >
      <div className="identity-current">
        <ActorChip actor={actor} />
        <code className="identifier">{actor.key}</code>
      </div>
      <p className="muted identity-copy">
        Unclaimed browsers use a non-human session actor so automation never
        impersonates a person. Claim your profile or set an explicit actor.
      </p>
      <div className="identity-presets">
        <button
          type="button"
          className={isJerred ? "selected" : ""}
          aria-pressed={isJerred}
          onClick={() => {
            saveActor(
              ActorSchema.parse({
                key: "human:jerred",
                kind: "human",
                name: "Jerred",
              }),
            );
            notify("Identity saved");
            onClose();
          }}
        >
          Use Jerred (human:jerred)
        </button>
        <button
          type="button"
          className={saved ? "" : "selected"}
          aria-pressed={!saved}
          onClick={() => {
            clearSavedActor();
            notify("Using session identity");
            onClose();
          }}
        >
          Use Unclaimed / Automation session
        </button>
      </div>
      <IdentityCustomForm
        key={`${actor.key}\u0000${actor.kind}\u0000${actor.name}`}
        actor={actor}
        onSaved={onClose}
      />
    </Modal>
  );
}
