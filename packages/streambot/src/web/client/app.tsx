import { useRemote } from "./use-remote.ts";
import { MediaList } from "./media-list.tsx";
import { Player, Queue } from "./player.tsx";
import { useEffect, useRef } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { usePageNavigation } from "./page-navigation.ts";

type Remote = ReturnType<typeof useRemote>;

export function App() {
  const remote = useRemote();
  const { me, snapshot } = remote;
  const location = useLocation();
  usePageNavigation();
  if (location.pathname === "/")
    return <Navigate replace to={"/plex" + location.search} />;
  return (
    <div className="app-shell">
      <header className="masthead">
        <Link className="brand" to="/plex" aria-label="Streambot home">
          <span className="brand-icon" aria-hidden="true">
            ▷
          </span>
          <span>
            streambot<span className="brand-dot">.</span>
          </span>
        </Link>
        <span className="masthead-tag">GOOD MEDIA. GOOD COMPANY.</span>
        {me !== null && (
          <div className="account">
            <span>{me.user.username}</span>
            <button
              onClick={() => {
                void remote.logout();
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      {remote.loading ? (
        <main className="loading-screen">
          <p>Connecting to Streambot…</p>
        </main>
      ) : me === null ? (
        <main className="welcome panel">
          <div className="welcome-copy">
            <p className="eyebrow">YOUR DISCORD MEDIA REMOTE</p>
            <h1>
              Press play.
              <br />
              Bring everyone.
            </h1>
            <p>
              Movies from your library. Music from across the web.
              <br />
              One little remote for your whole voice channel.
            </p>
            <a
              className="primary sign-in"
              href={
                "/api/auth/discord/start?" +
                new URLSearchParams({
                  returnTo: location.pathname + location.search + location.hash,
                }).toString()
              }
            >
              Continue with Discord <span aria-hidden="true">↗</span>
            </a>
            <p className="welcome-note">
              Join your voice channel, pick a title, and settle in.
            </p>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="art-ring ring-one"></div>
            <div className="art-ring ring-two"></div>
            <div className="art-play">▶</div>
            <span className="art-caption">PLAY SOMETHING TOGETHER</span>
          </div>
        </main>
      ) : (
        <>
          <ContextBar remote={remote} />
          {me.guilds.length === 0 ? (
            <div className="panel empty">
              <h2>No shared servers</h2>
              <p>
                Streambot needs to be installed in a server you belong to. Sign
                in again after joining a new server.
              </p>
            </div>
          ) : (
            <main className="main-grid">
              <MediaList
                guildId={remote.guildId}
                canPlay={
                  snapshot?.channel !== undefined && snapshot.channel !== null
                }
                busy={remote.busy}
                advanced={snapshot?.advancedControls === true}
                sportsEnabled={snapshot?.sportsEnabled === true}
                historyEnabled={snapshot?.historyEnabled}
                actionLabel={(selection, preferredChannel) => {
                  if (snapshot === null) return "Play";
                  if (
                    preferredChannel === undefined &&
                    snapshot.selectionMode === "auto" &&
                    (selection.kind === "candidate" ||
                      selection.kind === "url" ||
                      selection.kind === "history")
                  )
                    return "Play";
                  const number =
                    snapshot.selectionMode === "auto"
                      ? (preferredChannel ?? 2)
                      : snapshot.selectedPlaybackChannel;
                  const occupied =
                    number === null
                      ? snapshot.current !== null || snapshot.queue.length > 0
                      : snapshot.playbackChannels.find(
                          (slot) => slot.number === number,
                        )?.occupied === true;
                  return occupied ? "Queue" : "Play";
                }}
                play={(selection, placement) => {
                  void remote.send({ action: "play", selection, placement });
                }}
              />
              {snapshot !== null && (
                <Queue
                  snapshot={snapshot}
                  busy={remote.busy}
                  send={(action) => {
                    void remote.send(action);
                  }}
                  subtitles={() => {
                    void remote.openSubtitles();
                  }}
                />
              )}
            </main>
          )}
          {snapshot !== null && (
            <Player
              snapshot={snapshot}
              busy={remote.busy}
              send={(action) => {
                void remote.send(action);
              }}
              subtitles={() => {
                void remote.openSubtitles();
              }}
            />
          )}
        </>
      )}
      <Feedback remote={remote} />
      {remote.tracks !== null && <SubtitlePicker remote={remote} />}
      <footer className="site-footer">
        <span>STREAMBOT</span>
        <span>Made for the shared screen.</span>
        <details className="credits">
          <summary>Artwork credits</summary>
          <div>
            <a
              href="https://www.themoviedb.org"
              target="_blank"
              rel="noreferrer"
            >
              <img src="/tmdb.svg" alt="TMDB" width="92" height="40" />
            </a>
            <p>
              This product uses the TMDB API but is not endorsed or certified by
              TMDB.
            </p>
            <p>Video thumbnails are provided by YouTube.</p>
          </div>
        </details>
        <span className="footer-mark">↗</span>
      </footer>
    </div>
  );
}

function ContextBar({ remote }: { remote: Remote }) {
  const channel = remote.snapshot?.channel;
  return (
    <section className="context-bar" aria-label="Discord playback destination">
      <label>
        Server
        <select
          aria-label="Discord server"
          value={remote.guildId}
          onChange={(event) => {
            remote.setGuildId(event.target.value);
          }}
        >
          {remote.me?.guilds.map((guild) => (
            <option key={guild.id} value={guild.id}>
              {guild.name}
            </option>
          ))}
        </select>
      </label>
      {remote.snapshot?.playbackChannel != null && (
        <label>
          Streambot channel
          <select
            aria-label="Streambot channel"
            value={
              remote.snapshot.selectionMode === "auto"
                ? "auto"
                : (remote.snapshot.selectedPlaybackChannel ??
                  remote.snapshot.playbackChannel)
            }
            disabled={remote.busy}
            onChange={(event) => {
              void remote.send({
                action: "select",
                number:
                  event.target.value === "auto"
                    ? null
                    : Number(event.target.value),
              });
            }}
          >
            {remote.snapshot.automaticRoutingEnabled && (
              <option value="auto">Auto · music 1, video 2</option>
            )}
            {remote.snapshot.playbackChannels.map((slot) => (
              <option key={slot.number} value={slot.number}>
                {slot.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="channel-status">
        <span
          className={
            channel === undefined || channel === null
              ? "status-dot inactive"
              : "status-dot"
          }
        ></span>
        {channel?.name ?? "Join a Discord voice channel to play"}
      </div>
      <span className="context-note">Playback stays in Discord</span>
      {remote.snapshot !== null &&
        remote.snapshot.playbackChannels.length > 0 && (
          <nav className="channel-views" aria-label="View playback channels">
            {remote.snapshot.playbackChannels.map((slot) => (
              <ChannelView
                key={slot.number}
                number={slot.number}
                current={remote.snapshot?.playbackChannel === slot.number}
              />
            ))}
          </nav>
        )}
    </section>
  );
}

function ChannelView({
  number,
  current,
}: {
  number: number;
  current: boolean;
}) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("channel", String(number));
  return (
    <Link
      to={location.pathname + "?" + params.toString()}
      aria-current={current ? "page" : undefined}
    >
      View {number}
    </Link>
  );
}

function Feedback({ remote }: { remote: Remote }) {
  if (remote.error === "" && remote.notice === "") return null;
  return (
    <div
      className={remote.error === "" ? "toast" : "toast toast-error"}
      role={remote.error === "" ? "status" : "alert"}
    >
      <span>{remote.error === "" ? remote.notice : remote.error}</span>
      <button aria-label="Dismiss notification" onClick={remote.clearFeedback}>
        ×
      </button>
    </div>
  );
}

function SubtitlePicker({ remote }: { remote: Remote }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="subtitle-dialog panel"
      aria-labelledby="subtitle-heading"
      onClose={() => {
        remote.setTracks(null);
      }}
    >
      <div className="queue-heading">
        <h2 id="subtitle-heading">Choose subtitles</h2>
        <button
          aria-label="Close subtitle picker"
          onClick={() => {
            dialog.current?.close();
          }}
        >
          ×
        </button>
      </div>
      <p className="muted">Playback restarts at the current position.</p>
      {remote.tracks?.tracks.map((track) => (
        <button
          className="track-option"
          key={track.token}
          disabled={remote.busy}
          onClick={() => {
            void remote.send({ action: "subtitles", token: track.token });
          }}
        >
          {track.label}
          <span aria-hidden="true">→</span>
        </button>
      ))}
    </dialog>
  );
}
