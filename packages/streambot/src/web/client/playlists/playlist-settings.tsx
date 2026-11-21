import { useState } from "react";
import { useNavigate } from "react-router";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import { ChangeStatus } from "./change-status.tsx";
import { ImportForm } from "./link-forms.tsx";
import {
  copyName,
  playlistPath,
  shareUrl,
  type PlaylistPage,
} from "./playlist-model.ts";
import type { PlaylistHandle } from "./use-playlist.ts";
import { usePlaylistEdit } from "./use-playlist-edit.ts";
import "@shepherdjerred/streambot/web/client/styles/dialog.css";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

/** Renames the playlist in place. */
function RenameForm(props: { page: PlaylistPage; playlist: PlaylistHandle }) {
  const { edit } = usePlaylistEdit(props.playlist);
  const [name, setName] = useState(props.page.name);
  const control = useControl();
  return (
    <form
      className="playlist-form"
      aria-label="Rename this playlist"
      onSubmit={(event) => {
        event.preventDefault();
        if (control.pending) return;
        edit(
          control,
          { action: "rename", name: name.trim() },
          "Renamed to " + name.trim() + ".",
        );
      }}
    >
      <label className="field">
        Name
        <input
          required
          maxLength={100}
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
        {control.pending ? "Renaming…" : "Rename"}
      </button>
      <ChangeStatus
        control={control}
        onRefresh={props.playlist.refresh}
        className="playlist-form-status"
      />
    </form>
  );
}

/** A private copy under the viewer's own name; works on shared playlists too. */
function CopyForm(props: { page: PlaylistPage; playlist: PlaylistHandle }) {
  const { copy } = usePlaylistEdit(props.playlist);
  const navigate = useNavigate();
  const [name, setName] = useState(copyName(props.page.name));
  const control = useControl();
  return (
    <form
      className="playlist-form"
      aria-label="Copy to your playlists"
      onSubmit={(event) => {
        event.preventDefault();
        if (control.pending) return;
        copy(control, name.trim(), (made) => {
          void navigate(playlistPath(made.id));
        });
      }}
    >
      <label className="field">
        Name for your copy
        <input
          required
          maxLength={100}
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
        {control.pending ? "Copying…" : "Make a copy"}
      </button>
      <ControlStatus control={control} className="playlist-form-status" />
    </form>
  );
}

/** The link another member opens; it works only for signed-in members of this server. */
function ShareLink(props: { id: string }) {
  const remote = useRemote();
  const control = useControl();
  const url = shareUrl(globalThis.location.origin, remote.guildId, props.id);
  return (
    <div className="playlist-form">
      <label className="field playlist-field-wide">
        Share link
        <input
          readOnly
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={url}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
        <span className="field-hint">
          Only signed-in members of this server can open it.
        </span>
      </label>
      <button
        type="button"
        className="btn"
        aria-busy={control.pending}
        onClick={() => {
          control.run(async () => {
            try {
              await navigator.clipboard.writeText(url);
              return { ok: true, message: "Link copied." };
            } catch {
              return {
                ok: false,
                failure: {
                  status: 0,
                  code: "invalid_request",
                  message: "Copying was blocked. Select the link and copy it.",
                  reference: null,
                },
              };
            }
          });
        }}
      >
        Copy link
      </button>
      <ControlStatus control={control} className="playlist-form-status" />
    </div>
  );
}

/**
 * Settings that change a playlist rarely: its name, a link to import more tracks from, and the
 * private copy. Everyone can copy; only the owner can rename or import.
 */
export function PlaylistSettings(props: {
  page: PlaylistPage;
  playlist: PlaylistHandle;
}) {
  const { page, playlist } = props;
  const { edit } = usePlaylistEdit(playlist);
  return (
    <div className="playlist-settings">
      {page.guildId !== null && <ShareLink id={page.id} />}
      {page.owned && (
        <details className="playlist-more">
          <summary>Rename</summary>
          <RenameForm page={page} playlist={playlist} />
        </details>
      )}
      {page.owned && (
        <details className="playlist-more">
          <summary>Import tracks from a link</summary>
          <ImportForm
            label="Import tracks into this playlist"
            named={false}
            submit={(control, change) => {
              edit(
                control,
                change,
                (updated) => updated.notice ?? "Tracks imported.",
              );
            }}
          />
        </details>
      )}
      <details className="playlist-more">
        <summary>Copy to your playlists</summary>
        <CopyForm page={page} playlist={playlist} />
      </details>
    </div>
  );
}
