import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { PlaylistPageSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import {
  NO_VOICE,
  useRemote,
} from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import { mutationTask, playbackFor } from "./playlist-api.ts";
import {
  playlistPath,
  playlistRequest,
  type PlaylistPage,
} from "./playlist-model.ts";
import "@shepherdjerred/streambot/web/client/styles/dialog.css";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

/**
 * Saves what a player is playing, plus its queue, as a new private playlist. A native modal
 * dialog: the browser makes the page inert, traps focus and closes on Escape. The playlist is
 * only a snapshot; the queue keeps playing.
 */
export function SaveQueueDialog(props: { slot: number; onClose: () => void }) {
  const remote = useRemote();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<PlaylistPage | null>(null);
  const save = useControl();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      onClose={props.onClose}
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (saved !== null || save.pending) return;
          save.run(
            mutationTask(
              remote,
              PlaylistPageSchema,
              () => {
                const playback = playbackFor(remote, props.slot);
                return playback === null
                  ? { ok: false, failure: NO_VOICE }
                  : {
                      ok: true,
                      body: playlistRequest(playback.guildId, null, {
                        action: "save",
                        name: name.trim(),
                        playback: playback.playback,
                      }),
                    };
              },
              (page) => {
                setSaved(page);
                return (
                  "Saved " +
                  String(page.count) +
                  (page.count === 1 ? " item." : " items.")
                );
              },
            ),
          );
        }}
      >
        <h2 id={titleId} className="dialog-title">
          Save as playlist
        </h2>
        <p className="muted">
          Saves what is playing and the queue after it as a private playlist.
          You can share it with the server later.
        </p>
        <label className="field">
          Playlist name
          <input
            required
            maxLength={100}
            placeholder="A good evening"
            value={name}
            readOnly={saved !== null}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <ControlStatus surface="dialog" control={save} />
        <div className="dialog-actions btn-row">
          {saved === null ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-listen"
                aria-busy={save.pending}
                aria-disabled={save.pending}
              >
                {save.pending ? "Saving…" : "Save playlist"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => dialog.current?.close()}
              >
                Close
              </button>
              <Link
                className="btn btn-listen"
                to={playlistPath(saved.id)}
                onClick={() => dialog.current?.close()}
              >
                Open playlist
              </Link>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
