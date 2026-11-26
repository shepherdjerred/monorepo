import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import {
  Activity,
  Ellipsis,
  Folder,
  Keyboard,
  LayoutGrid,
  List,
  Search,
  Settings2,
  Users,
  MessagesSquare,
} from "lucide-react";
import {
  AppSwitcher,
  IconButton,
  Sidebar as ConsoleSidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  type AppSwitcherEntry,
  type SidebarLinkProps,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
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
import { trackerTheme } from "#client/ui/theme.ts";

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
/** Every console, Tracker marked current; each opens in this tab. */
const switcherApps: readonly AppSwitcherEntry[] = CONSOLE_LINKS.map(
  ({ label, url, group }) => ({ label, url, group }),
);
const currentApp = { label: "Tracker", mark: "T" } as const;

/** A react-router `NavLink` drawn as a console sidebar row. */
function sidebarLink({ href, ...props }: SidebarLinkProps) {
  return <NavLink to={href} {...props} />;
}

/**
 * The navigation above tablet width, drawn by the shared console sidebar:
 * the app switcher and search, the workspace pages, saved views, teams and
 * projects, then identity, settings, shortcuts and the theme row.
 */
export function Sidebar({
  bootstrap,
  teamKey,
  search,
  help,
  identity,
}: {
  bootstrap: BootstrapData | undefined;
  teamKey: string | undefined;
  search: () => void;
  help: () => void;
  identity: () => void;
}) {
  const actor = useCurrentActor();
  return (
    <ConsoleSidebar
      label="Tracker"
      navLabel="Main navigation"
      top={
        <>
          <AppSwitcher current={currentApp} apps={switcherApps} />
          <IconButton
            icon={Search}
            label="Search issues and commands"
            aria-keyshortcuts="Meta+K Control+K"
            title="Search (⌘K)"
            onClick={search}
          />
        </>
      }
      footer={
        <div className="sidebar-footer">
          <button
            type="button"
            className="ui-nav-item identity-button"
            aria-haspopup="dialog"
            onClick={identity}
          >
            <Avatar actor={actor} decorative />
            <span className="ui-nav-text">
              <span className="sr-only">Acting as </span>
              {actor.name}
            </span>
          </button>
          <NavLink to="/settings" className="ui-nav-item">
            <Settings2 className="ui-nav-icon" aria-hidden="true" />
            <span className="ui-nav-text">Settings</span>
          </NavLink>
          <button
            type="button"
            className="ui-nav-item"
            aria-keyshortcuts="?"
            onClick={help}
          >
            <Keyboard className="ui-nav-icon" aria-hidden="true" />
            <span className="ui-nav-text">Keyboard shortcuts</span>{" "}
            <kbd className="ui-nav-count">?</kbd>
          </button>
          <ThemeRow store={trackerTheme} />
        </div>
      }
    >
      <SidebarGroup label="Workspace">
        {links.map((link) => (
          <SidebarItem
            key={link.path}
            href={link.path}
            label={link.name}
            icon={link.icon}
            renderLink={sidebarLink}
          />
        ))}
      </SidebarGroup>
      {bootstrap !== undefined && teamKey !== undefined && (
        <ViewsNav bootstrap={bootstrap} teamKey={teamKey} />
      )}
      {bootstrap !== undefined && (
        <SidebarGroup label="Teams">
          {bootstrap.teams.map((team) => (
            <li key={team.id}>
              <Link
                to={`/issues?team=${team.key}`}
                className="ui-nav-item team-link"
                data-current-team={teamKey === team.key ? "" : undefined}
                onClick={() => {
                  rememberTeam(team.key);
                }}
              >
                <span className="team-icon" aria-hidden="true">
                  {team.key}
                </span>
                <span className="ui-nav-text">{team.name}</span>
              </Link>
            </li>
          ))}
        </SidebarGroup>
      )}
      {bootstrap !== undefined && (
        <SidebarGroup label="Projects">
          {bootstrap.projects
            .filter(({ archivedAt }) => archivedAt === null)
            .map((project) => (
              <li key={project.id}>
                <NavLink
                  to={`/projects/${project.slug}`}
                  className="ui-nav-item project-link"
                >
                  <span className="ui-nav-icon project-icon" aria-hidden="true">
                    <Swatch color={project.color} />
                  </span>
                  <span className="ui-nav-text">{project.name}</span>
                </NavLink>
              </li>
            ))}
        </SidebarGroup>
      )}
    </ConsoleSidebar>
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

export function ActorIdentityForm({
  actor,
  idPrefix,
  className,
  footerNote,
  onSaved,
}: {
  actor: ActorEnvelope;
  idPrefix: string;
  className?: string;
  footerNote?: string;
  onSaved?: () => void;
}) {
  const [name, setName] = useState(actor.name);
  const [key, setKey] = useState(actor.key);
  const [kind, setKind] = useState<ActorEnvelope["kind"]>(actor.kind);
  const [error, setError] = useState<unknown>();
  const clearError = () => {
    if (error !== undefined) {
      setError(undefined);
    }
  };
  const nameField = (
    <label htmlFor={`${idPrefix}-name`}>
      Name
      <input
        id={`${idPrefix}-name`}
        value={name}
        required
        onChange={(event) => {
          setName(event.target.value);
          clearError();
        }}
      />
    </label>
  );
  const kindField = (
    <label htmlFor={`${idPrefix}-kind`}>
      Kind
      <select
        id={`${idPrefix}-kind`}
        value={kind}
        onChange={(event) => {
          setKind(ActorSchema.shape.kind.parse(event.target.value));
          clearError();
        }}
      >
        {ActorSchema.shape.kind.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
  const keyField = (
    <label htmlFor={`${idPrefix}-key`}>
      Actor key
      <input
        id={`${idPrefix}-key`}
        value={key}
        required
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => {
          setKey(event.target.value);
          clearError();
        }}
      />
    </label>
  );
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        try {
          saveActor(ActorSchema.parse({ key, name, kind }));
          setError(undefined);
          notify("Identity saved");
          onSaved?.();
        } catch (error_) {
          setError(error_);
        }
      }}
    >
      {footerNote === undefined ? (
        <>
          {nameField}
          {keyField}
          {kindField}
          <button type="submit" className="primary">
            Save identity
          </button>
          {error !== undefined && <ErrorNotice error={error} />}
        </>
      ) : (
        <>
          <div className="form-selects">
            {nameField}
            {kindField}
          </div>
          {keyField}
          {error !== undefined && <ErrorNotice error={error} />}
          <div className="modal-footer">
            <span className="muted">{footerNote}</span>
            <button type="submit" className="primary">
              Save identity
            </button>
          </div>
        </>
      )}
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
      <ActorIdentityForm
        key={`${actor.key}\u0000${actor.kind}\u0000${actor.name}`}
        actor={actor}
        idPrefix="identity-modal"
        className="identity-form"
        footerNote="Saved to this browser profile"
        onSaved={onClose}
      />
    </Modal>
  );
}
