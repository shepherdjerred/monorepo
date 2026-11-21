import { Link, NavLink } from "react-router";
import { useControl } from "./use-control.ts";
import { ControlStatus } from "./control-status.tsx";
import { apiRequest, postJson } from "./api.ts";
import { useRemote } from "./remote.tsx";
import { SearchBox } from "./search/search-box.tsx";
import { z } from "zod";
import "./styles/shell.css";

const PAGES = [
  ["/library", "Library"],
  ["/playlists", "Playlists"],
  ["/live", "Live"],
  ["/history", "History"],
] as const;

/**
 * Where the viewer is, detected from Discord. A server switcher appears only when they are in no
 * voice channel and share more than one server with Streambot, so it can never move a room.
 */
function Context() {
  const remote = useRemote();
  const { room } = remote;
  if (room === null) return <span className="context muted">Connecting…</span>;
  if (room.location !== null)
    return (
      <span className="context">
        <span className="context-dot" aria-hidden="true" />
        <span className="visually-hidden">In voice channel </span>
        <strong>{room.location.channel.name}</strong>
        <span className="muted"> · {room.location.guild.name}</span>
      </span>
    );
  return (
    <span className="context">
      <span className="context-dot context-off" aria-hidden="true" />
      <span className="muted">Not in voice</span>
      {room.guilds.length > 1 && (
        <label className="context-switch">
          <span className="visually-hidden">Server to browse</span>
          <select
            value={room.browseGuildId}
            onChange={(event) => {
              remote.chooseGuild(event.target.value);
            }}
          >
            {room.guilds.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </span>
  );
}

function Account() {
  const remote = useRemote();
  const control = useControl();
  return (
    <div className="account">
      <span className="account-name">{remote.me.user.username}</span>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        aria-busy={control.pending}
        onClick={() => {
          control.run(async (signal) => {
            const result = await apiRequest(
              "/api/auth/logout",
              z.unknown(),
              postJson({}, remote.me.csrfToken, signal),
            );
            if (!result.ok) return { ok: false, failure: result.failure };
            globalThis.location.assign("/");
            return { ok: true, message: "" };
          });
        }}
      >
        Sign out
      </button>
      <ControlStatus className="account-status" control={control} />
    </div>
  );
}

export function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="Streambot home">
          streambot
        </Link>
        <SearchBox />
        <Context />
        <Account />
        <nav className="nav" aria-label="Browse">
          {PAGES.map(([href, label]) => (
            <NavLink key={href} to={href} className="nav-link">
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

/** The two verbs, explained once, naming where they play. */
export function Legend() {
  const remote = useRemote();
  const place = remote.target?.voiceChannelName;
  return (
    <p className="legend" id="voice-legend">
      {place === undefined ? (
        <>
          Join a voice channel in Discord to play. You can still search and
          browse.
        </>
      ) : (
        <>
          <span className="legend-verb legend-listen">♪ Listen</span> plays
          audio in {place}; everyone there hears it.{" "}
          <span className="legend-verb legend-watch">▶ Watch</span> starts a
          stream in {place} that people open in Discord.
        </>
      )}
    </p>
  );
}
