import { useId, useState } from "react";
import { Link } from "react-router";
import {
  isImportablePlaylistUrl,
  type PlaylistMutationSchema,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import type { z } from "zod";

type Mutation = Omit<z.infer<typeof PlaylistMutationSchema>, "guildId">;

export function PlaylistImportForm({
  initialUrl,
  busy,
  mutation,
}: {
  initialUrl: string;
  busy: boolean;
  mutation: (change: Mutation) => void;
}) {
  const headingId = useId();
  const hintId = useId();
  const urlId = useId();
  const nameId = useId();
  const [url, setUrl] = useState(initialUrl);
  const [customName, setCustomName] = useState("");
  return (
    <form
      aria-labelledby={headingId}
      method="post"
      action="/api/playlists"
      className="playlist-import-form filters"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedName = customName.trim();
        mutation({
          action: "import",
          url: url.trim(),
          ...(trimmedName === "" ? {} : { name: trimmedName }),
        });
      }}
    >
      <h2 id={headingId} className="playlist-form-heading">
        Import from YouTube or Spotify
      </h2>
      <p id={hintId} className="muted playlist-form-hint">
        Saves a one-time snapshot of a public Spotify playlist, album, or track,
        or a YouTube playlist.
      </p>
      <div className="filter-label">
        <label htmlFor={urlId}>Playlist or album URL</label>
        <input
          id={urlId}
          name="url"
          type="url"
          required
          maxLength={500}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={hintId}
          placeholder="https://open.spotify.com/playlist/…"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
      </div>
      <div className="filter-label">
        <label htmlFor={nameId}>Playlist name (optional)</label>
        <input
          id={nameId}
          name="playlistName"
          type="text"
          maxLength={100}
          placeholder="Uses imported title"
          value={customName}
          onChange={(event) => {
            setCustomName(event.target.value);
          }}
        />
      </div>
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Importing…" : "Import playlist"}
      </button>
    </form>
  );
}

export function PlaylistAppendImportForm({
  busy,
  mutation,
}: {
  busy: boolean;
  mutation: (change: Mutation) => void;
}) {
  const headingId = useId();
  const urlId = useId();
  const [url, setUrl] = useState("");
  return (
    <form
      aria-labelledby={headingId}
      method="post"
      action="/api/playlists"
      className="playlist-append-form filters"
      onSubmit={(event) => {
        event.preventDefault();
        mutation({ action: "import", url: url.trim() });
      }}
    >
      <h3 id={headingId} className="playlist-form-heading">
        Import tracks from link
      </h3>
      <div className="filter-label">
        <label htmlFor={urlId}>Playlist or album URL</label>
        <input
          id={urlId}
          name="importUrl"
          type="url"
          required
          maxLength={500}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://open.spotify.com/playlist/… or YouTube playlist"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
      </div>
      <button type="submit" disabled={busy}>
        {busy ? "Importing…" : "Import tracks"}
      </button>
    </form>
  );
}

export function SearchImportPlaylistLink({
  guildId,
  url,
}: {
  guildId: string;
  url: string;
}) {
  if (!isImportablePlaylistUrl(url)) {
    return null;
  }
  return (
    <p className="import-playlist-callout">
      <Link
        to={
          "/playlists?" +
          new URLSearchParams({ guild: guildId, import: url }).toString()
        }
      >
        Import as saved playlist →
      </Link>
    </p>
  );
}
