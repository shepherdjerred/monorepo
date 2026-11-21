import { useState } from "react";
import { useNavigate } from "react-router";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import {
  useControl,
  type Control,
} from "@shepherdjerred/streambot/web/client/use-control.ts";
import { ActionDialog } from "./action-dialog.tsx";
import { importRefusal, refusal } from "./link-forms.tsx";
import { copyName, playlistPath, type PlaylistPage } from "./playlist-model.ts";
import type { PlaylistHandle } from "./use-playlist.ts";
import { usePlaylistEdit } from "./use-playlist-edit.ts";

type DialogProps = {
  page: PlaylistPage;
  playlist: PlaylistHandle;
  onClose: () => void;
};

/** The one-field dialog behind Rename and Copy: a name, and what happens with it. */
function NameDialog(
  props: DialogProps & {
    title: string;
    description?: string;
    label: string;
    initial: string;
    submit: string;
    pendingLabel: string;
    run: (control: Control, name: string, close: () => void) => void;
  },
) {
  const [name, setName] = useState(props.initial);
  const control = useControl();
  return (
    <ActionDialog
      title={props.title}
      control={control}
      submit={props.submit}
      pendingLabel={props.pendingLabel}
      onRefresh={props.playlist.refresh}
      onClose={props.onClose}
      onSubmit={(close) => {
        props.run(control, name.trim(), close);
      }}
      {...(props.description === undefined
        ? {}
        : { description: props.description })}
    >
      <label className="field">
        {props.label}
        <input
          required
          maxLength={100}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
    </ActionDialog>
  );
}

export function RenameDialog(props: DialogProps) {
  const { edit } = usePlaylistEdit(props.playlist);
  return (
    <NameDialog
      {...props}
      title="Rename playlist"
      label="Name"
      initial={props.page.name}
      submit="Rename"
      pendingLabel="Renaming…"
      run={(control, name, close) => {
        edit(
          control,
          { action: "rename", name },
          "Renamed to " + name + ".",
          close,
        );
      }}
    />
  );
}

/** A private copy under the viewer's own name; works on shared playlists too. */
export function CopyDialog(props: DialogProps) {
  const { copy } = usePlaylistEdit(props.playlist);
  const navigate = useNavigate();
  return (
    <NameDialog
      {...props}
      title="Copy to your playlists"
      description="Makes a private copy that you can change."
      label="Name for your copy"
      initial={copyName(props.page.name)}
      submit="Make a copy"
      pendingLabel="Copying…"
      run={(control, name, close) => {
        copy(control, name, (made) => {
          close();
          void navigate(playlistPath(made.id));
        });
      }}
    />
  );
}

/** What an import says it did, including any items it skipped. */
function importedWords(page: PlaylistPage): string {
  return page.notice ?? "Tracks imported.";
}

/**
 * Imports the tracks behind a public Spotify playlist, album or track link, or a YouTube playlist
 * link, into this playlist. Imports are a one-time snapshot, and a large one can take a while.
 */
export function ImportDialog(
  props: DialogProps & { onImported: (notice: string) => void },
) {
  const { edit } = usePlaylistEdit(props.playlist);
  const remote = useRemote();
  const [url, setUrl] = useState("");
  const control = useControl();
  const spotifyOff = remote.room?.capabilities.spotifyLinks !== true;
  return (
    <ActionDialog
      title="Import from a link"
      description="Adds the tracks behind a public Spotify playlist, album or track link, or a YouTube playlist link. A large import can take a while."
      control={control}
      submit="Import"
      pendingLabel="Importing…"
      onRefresh={props.playlist.refresh}
      onClose={props.onClose}
      onSubmit={(close) => {
        const refused = importRefusal(url, spotifyOff);
        if (refused !== null) {
          control.explain(refusal(refused));
          return;
        }
        edit(
          control,
          { action: "import", url: url.trim() },
          importedWords,
          (updated) => {
            props.onImported(importedWords(updated));
            close();
          },
        );
      }}
    >
      <label className="field">
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
    </ActionDialog>
  );
}

/** A native confirm: Keep has focus first, so Enter never deletes by accident. */
export function DeleteDialog(props: DialogProps) {
  const { remove } = usePlaylistEdit(props.playlist);
  const navigate = useNavigate();
  const control = useControl();
  return (
    <ActionDialog
      title="Delete playlist"
      description={`Delete “${props.page.name}”? This cannot be undone.`}
      control={control}
      submit="Delete"
      pendingLabel="Deleting…"
      cancel="Keep"
      danger
      onRefresh={props.playlist.refresh}
      onClose={props.onClose}
      onSubmit={(close) => {
        remove(control, () => {
          close();
          void navigate("/playlists");
        });
      }}
    />
  );
}
