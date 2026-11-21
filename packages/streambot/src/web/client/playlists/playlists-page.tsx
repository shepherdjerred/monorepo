import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  PlaylistListSchema,
  PlaylistPageSchema,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { apiUrl } from "@shepherdjerred/streambot/web/client/api.ts";
import { ItemSection } from "@shepherdjerred/streambot/web/client/media/item-section.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import type { Control } from "@shepherdjerred/streambot/web/client/use-control.ts";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import { CreateForm, ImportForm } from "./link-forms.tsx";
import { mutationTask, PLAYLISTS_URL } from "./playlist-api.ts";
import {
  parsePlaylistsSearch,
  playlistListItem,
  playlistPath,
  playlistRequest,
  type PlaylistChange,
} from "./playlist-model.ts";
import "@shepherdjerred/streambot/web/client/styles/home.css";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

/** Old share links (`/playlists?guild=…&playlist=…`) open the playlist's own page. */
function useLegacyLink(playlist: string | null, guild: string | null): boolean {
  const navigate = useNavigate();
  useEffect(() => {
    if (playlist === null) return;
    const query =
      guild === null ? "" : "?" + new URLSearchParams({ guild }).toString();
    void navigate(playlistPath(playlist) + query, { replace: true });
  }, [navigate, playlist, guild]);
  return playlist !== null;
}

function Heading() {
  return (
    <h1 className="page-heading" id="page-heading" tabIndex={-1}>
      Playlists
    </h1>
  );
}

/**
 * Your playlists and the ones shared in this server, with ways to start another: an empty one,
 * or an import from a Spotify or YouTube link. Each row opens the playlist's page.
 */
export function PlaylistsPage() {
  const remote = useRemote();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const search = parsePlaylistsSearch(params);
  const redirecting = useLegacyLink(search.playlist, search.guild);
  const guildId = remote.room === null ? "" : remote.guildId;
  const enabled = remote.room?.capabilities.playlists === true;
  const listen = remote.room?.capabilities.listen === true;
  const active = enabled && guildId !== "" && !redirecting;
  const mine = useLoad(
    active ? apiUrl(PLAYLISTS_URL, { guildId, scope: "mine" }) : null,
    PlaylistListSchema,
  );
  const server = useLoad(
    active ? apiUrl(PLAYLISTS_URL, { guildId, scope: "server" }) : null,
    PlaylistListSchema,
  );
  if (redirecting) return null;
  if (!enabled && remote.room !== null)
    return (
      <div className="page">
        <Heading />
        <p className="empty-note">Playlists are not enabled in this server.</p>
      </div>
    );
  /** Creating or importing opens the new playlist, with any import note carried along. */
  const submit = (
    control: Control,
    change: PlaylistChange & { action: "create" | "import" },
  ) => {
    control.run(
      mutationTask(
        remote,
        PlaylistPageSchema,
        () => ({
          ok: true,
          body: playlistRequest(remote.guildId, null, change),
        }),
        (page) => {
          void navigate(playlistPath(page.id), {
            state: { notice: page.notice ?? "" },
          });
          return "";
        },
      ),
    );
  };
  return (
    <div className="page">
      <Heading />
      <section className="section" aria-labelledby="playlist-new">
        <div className="section-head">
          <h2 id="playlist-new" className="section-heading">
            Start a playlist
          </h2>
        </div>
        <CreateForm submit={submit} />
        <ImportForm
          key={search.importUrl}
          label="Import a playlist from a link"
          initialUrl={search.importUrl}
          named
          submit={submit}
        />
        <p className="muted playlist-hint">
          Import saves a one-time copy of a public Spotify playlist, album or
          track, or a YouTube playlist. To save what is playing, use Save as
          playlist on its player.
        </p>
      </section>
      <ItemSection
        title="Your playlists"
        load={mine.state}
        onRetry={mine.retry}
        items={(data) =>
          data.map((item) => playlistListItem(item, listen, guildId))
        }
        empty="You have no playlists yet. Start one above."
      />
      <ItemSection
        title="Shared in this server"
        load={server.state}
        onRetry={server.retry}
        items={(data) =>
          data.map((item) => playlistListItem(item, listen, guildId))
        }
        empty="Nobody has shared a playlist here yet."
      />
    </div>
  );
}
