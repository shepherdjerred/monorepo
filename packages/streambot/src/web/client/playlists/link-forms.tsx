import { useState } from "react";
import { isImportablePlaylistUrl } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import {
  useControl,
  type Control,
} from "@shepherdjerred/streambot/web/client/use-control.ts";
import { isSpotifyLink, type PlaylistChange } from "./playlist-model.ts";
import "@shepherdjerred/streambot/web/client/styles/dialog.css";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

type Submit<Change extends PlaylistChange> = (
  control: Control,
  change: Change,
) => void;
type CreateChange = PlaylistChange & { action: "create" };
type ImportChange = PlaylistChange & { action: "import" };

/** A refusal the form shows without asking the server. */
export function refusal(message: string) {
  return { status: 0, code: "invalid_request", message, reference: null };
}

/** Why a link cannot be imported, checked before the server is asked; null when it can be. */
export function importRefusal(url: string, spotifyOff: boolean): string | null {
  if (!isImportablePlaylistUrl(url))
    return "Paste a public Spotify playlist, album or track link, or a YouTube playlist link.";
  return spotifyOff && isSpotifyLink(url)
    ? "Spotify links are not enabled in this server."
    : null;
}

/** A name for a new private playlist. */
export function CreateForm(props: { submit: Submit<CreateChange> }) {
  const [name, setName] = useState("");
  const control = useControl();
  return (
    <form
      className="playlist-form"
      aria-label="Create a playlist"
      onSubmit={(event) => {
        event.preventDefault();
        if (control.pending) return;
        props.submit(control, { action: "create", name: name.trim() });
      }}
    >
      <label className="field">
        Playlist name
        <input
          required
          maxLength={100}
          placeholder="A good evening"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <button
        type="submit"
        className="btn"
        aria-busy={control.pending}
        aria-disabled={control.pending}
      >
        {control.pending ? "Creating…" : "Create playlist"}
      </button>
      <ControlStatus control={control} className="playlist-form-status" />
    </form>
  );
}

/**
 * Imports the tracks behind a public Spotify playlist, album or track link, or a YouTube
 * playlist link. Imports are a one-time snapshot, and a large one can take a while.
 */
export function ImportForm(props: {
  label: string;
  initialUrl?: string;
  named: boolean;
  submit: Submit<ImportChange>;
}) {
  const remote = useRemote();
  const [url, setUrl] = useState(props.initialUrl ?? "");
  const [name, setName] = useState("");
  const control = useControl();
  const spotifyOff = remote.room?.capabilities.spotifyLinks !== true;
  return (
    <form
      className="playlist-form"
      aria-label={props.label}
      onSubmit={(event) => {
        event.preventDefault();
        if (control.pending) return;
        const refused = importRefusal(url, spotifyOff);
        if (refused !== null) {
          control.explain(refusal(refused));
          return;
        }
        const trimmed = name.trim();
        props.submit(control, {
          action: "import",
          url: url.trim(),
          ...(trimmed !== "" && props.named ? { name: trimmed } : {}),
        });
      }}
    >
      <label className="field playlist-field-wide">
        Link
        <input
          type="url"
          required
          maxLength={500}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://open.spotify.com/playlist/…"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
      </label>
      {props.named && (
        <label className="field">
          Name (optional)
          <input
            maxLength={100}
            placeholder="Uses the imported title"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
      )}
      <button
        type="submit"
        className="btn"
        aria-busy={control.pending}
        aria-disabled={control.pending}
      >
        {control.pending ? "Importing…" : "Import"}
      </button>
      <ControlStatus control={control} className="playlist-form-status" />
    </form>
  );
}
