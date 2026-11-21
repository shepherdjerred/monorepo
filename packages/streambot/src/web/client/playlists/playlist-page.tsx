import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { FailureNotice } from "@shepherdjerred/streambot/web/client/failure-notice.tsx";
import { SkeletonRows } from "@shepherdjerred/streambot/web/client/media/media-row.tsx";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { AddPlaying } from "./add-playing.tsx";
import { PlaylistEntryRow } from "./playlist-entry.tsx";
import { PlaylistHeader } from "./playlist-header.tsx";
import {
  navigationNotice,
  PAGE_SIZE,
  playlistListItem,
  type PlaylistPage as Page,
} from "./playlist-model.ts";
import { usePlaylist, type PlaylistHandle } from "./use-playlist.ts";
import "@shepherdjerred/streambot/web/client/styles/home.css";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

/** A share link names its server; the page waits until the remote is browsing it. */
function useLinkedGuild(guild: string | null): string | null {
  const remote = useRemote();
  const member =
    guild !== null && remote.me.guilds.some((entry) => entry.id === guild);
  const wanted = member ? guild : null;
  useEffect(() => {
    if (wanted !== null && wanted !== remote.guildId)
      remote.chooseGuild(wanted);
  }, [wanted, remote]);
  if (remote.room === null) return null;
  return wanted !== null && wanted !== remote.guildId ? null : remote.guildId;
}

function Paging(props: { page: Page; offset: number }) {
  const [params] = useSearchParams();
  const link = (offset: number) => {
    const next = new URLSearchParams(params);
    if (offset === 0) next.delete("offset");
    else next.set("offset", String(offset));
    const query = next.toString();
    return query === "" ? "?" : "?" + query;
  };
  const { count } = props.page;
  const from = Math.min(props.offset, count);
  const to = Math.min(props.offset + PAGE_SIZE, count);
  if (count <= PAGE_SIZE) return null;
  return (
    <nav className="playlist-paging btn-row" aria-label="Playlist pages">
      {props.offset > 0 && (
        <Link className="btn" to={link(Math.max(0, props.offset - PAGE_SIZE))}>
          Previous
        </Link>
      )}
      <span className="muted numeric">
        {from + 1}–{to} of {count}
      </span>
      {to < count && (
        <Link className="btn" to={link(props.offset + PAGE_SIZE)}>
          Next
        </Link>
      )}
    </nav>
  );
}

function Items(props: {
  page: Page;
  playlist: PlaylistHandle;
  offset: number;
  onRemoved: () => void;
}) {
  const { page } = props;
  if (page.items.length === 0)
    return (
      <p className="empty-note">
        {page.owned
          ? "This playlist is empty. Add a song from a search result, add what is playing, or import a link."
          : "This playlist is empty."}
      </p>
    );
  return (
    <ul className="rows" data-row-scope="playlist">
      {page.items.map((entry, index) => (
        <PlaylistEntryRow
          key={entry.id}
          entry={entry}
          index={props.offset + index}
          count={page.count}
          owned={page.owned}
          playlist={props.playlist}
          onRemoved={props.onRemoved}
        />
      ))}
    </ul>
  );
}

function Loaded(props: {
  page: Page;
  playlist: PlaylistHandle;
  offset: number;
  notice: string;
}) {
  const { page } = props;
  const remote = useRemote();
  const listen = remote.room?.capabilities.listen === true;
  const heading = useRef<HTMLHeadingElement>(null);
  const [imported, setImported] = useState("");
  const whole = playlistListItem(page, listen, remote.guildId);
  const notice = imported === "" ? props.notice : imported;
  // What plays in the viewer's room can only be added from inside the server being browsed.
  const playing =
    page.owned && remote.target?.guildId === remote.guildId
      ? (remote.room?.players.filter((player) => player.current !== null) ?? [])
      : [];
  return (
    <>
      <PlaylistHeader
        page={page}
        playlist={props.playlist}
        whole={whole}
        artworkUrl={musicArtworkUrl(page.cover, remote.guildId)}
        heading={heading}
        onImported={setImported}
      />
      {notice !== "" && (
        <p className="status" role="status">
          {notice}
        </p>
      )}
      <section className="section" aria-labelledby="playlist-items">
        <div className="section-head">
          <h2 id="playlist-items" className="section-heading">
            Items
          </h2>
          <AddPlaying players={playing} playlist={props.playlist} />
        </div>
        <Items
          page={page}
          playlist={props.playlist}
          offset={props.offset}
          onRemoved={() => {
            heading.current?.focus();
          }}
        />
      </section>
      <Paging page={page} offset={props.offset} />
    </>
  );
}

/**
 * One playlist: play it whole, edit it if it is yours, copy it if it is shared. Items page 50 at
 * a time through `?offset=`. Every edit carries the revision this page saw, so a playlist changed
 * elsewhere is refused with a Refresh instead of overwritten.
 */
export function PlaylistPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "0", 10));
  const guild = params.get("guild");
  const guildId = useLinkedGuild(
    guild !== null && /^\d+$/u.test(guild) ? guild : null,
  );
  const room = useRemote().room;
  const enabled = room?.capabilities.playlists === true;
  const playlist = usePlaylist(
    guildId === null || !enabled || id === "" ? null : guildId,
    id,
    Number.isNaN(offset) ? 0 : offset,
  );
  const { state } = playlist;
  if (room !== null && !enabled)
    return (
      <div className="page">
        <h1 className="page-heading" id="page-heading" tabIndex={-1}>
          Playlist
        </h1>
        <p className="empty-note">Playlists are not enabled in this server.</p>
      </div>
    );
  return (
    <div className="page" aria-busy={state.status === "loading"}>
      <Link className="playlist-back" to="/playlists">
        ← Playlists
      </Link>
      {state.status === "loading" && (
        <ul className="rows">
          <SkeletonRows count={4} />
        </ul>
      )}
      {state.status === "failed" && (
        <>
          <h1 className="page-heading" id="page-heading" tabIndex={-1}>
            Playlist
          </h1>
          <p className="status">
            <FailureNotice failure={state.failure} onRetry={playlist.retry} />
          </p>
        </>
      )}
      {state.status === "done" && (
        <Loaded
          page={state.data}
          playlist={playlist}
          offset={Number.isNaN(offset) ? 0 : offset}
          notice={navigationNotice(location.state)}
        />
      )}
    </div>
  );
}
