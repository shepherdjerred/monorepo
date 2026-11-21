import { useState } from "react";
import { useNavigate } from "react-router";
import { TRANSPORT_NAME } from "@shepherdjerred/streambot/web/client/commands.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { PlaylistPageSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { ChangeStatus } from "./change-status.tsx";
import { mutationTask, playbackFor } from "./playlist-api.ts";
import { playlistRequest, type PlaylistPage } from "./playlist-model.ts";
import type { PlaylistHandle } from "./use-playlist.ts";
import { usePlaylistEdit } from "./use-playlist-edit.ts";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

const NOTHING_PLAYING = {
  status: 0,
  code: "invalid_request",
  message: "Nothing is playing there any more.",
  reference: null,
};

/** Adds what a room player is playing now to this playlist. */
function AddCurrent(props: {
  player: WebRoomPlayer;
  several: boolean;
  playlist: PlaylistHandle;
}) {
  const remote = useRemote();
  const control = useControl();
  const { slot } = props.player;
  const label = props.several
    ? "Add current " + TRANSPORT_NAME[props.player.transport] + " item"
    : "Add current song";
  return (
    <span className="playlist-tool">
      <button
        type="button"
        className="btn"
        aria-busy={control.pending}
        aria-disabled={control.pending}
        onClick={() => {
          if (control.pending) return;
          control.run(
            mutationTask(
              remote,
              PlaylistPageSchema,
              () => {
                const target = props.playlist.target();
                const playback = playbackFor(remote, slot);
                if (target === null || playback === null)
                  return { ok: false, failure: NOTHING_PLAYING };
                return {
                  ok: true,
                  body: playlistRequest(playback.guildId, target, {
                    action: "add",
                    playback: playback.playback,
                  }),
                };
              },
              (page) => {
                props.playlist.adopt(page);
                props.playlist.refresh();
                return "Added to this playlist.";
              },
            ),
          );
        }}
      >
        {control.pending ? "Adding…" : label}
      </button>
      <ChangeStatus control={control} onRefresh={props.playlist.refresh} />
    </span>
  );
}

/** Delete asks twice, in place: the first press arms it, the second deletes. */
function DeleteButton(props: { playlist: PlaylistHandle; name: string }) {
  const navigate = useNavigate();
  const { remove } = usePlaylistEdit(props.playlist);
  const [armed, setArmed] = useState(false);
  const control = useControl();
  if (!armed)
    return (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setArmed(true);
        }}
      >
        Delete playlist
      </button>
    );
  return (
    <span className="btn-row" role="group" aria-label="Confirm delete">
      <span className="muted">
        Delete {props.name}? Playback already queued continues.
      </span>
      <button
        type="button"
        className="btn"
        aria-busy={control.pending}
        aria-disabled={control.pending}
        onClick={() => {
          if (control.pending) return;
          remove(control, () => {
            void navigate("/playlists");
          });
        }}
      >
        {control.pending ? "Deleting…" : "Delete it"}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setArmed(false);
          control.dismiss();
        }}
      >
        Keep it
      </button>
      <ChangeStatus control={control} onRefresh={props.playlist.refresh} />
    </span>
  );
}

/**
 * The owner's actions on the whole playlist: share it with the server or make it private, add
 * what is playing, and delete. Add current song needs the viewer to be in the server being
 * browsed, because the server reads that room's queue.
 */
export function PlaylistTools(props: {
  page: PlaylistPage;
  playlist: PlaylistHandle;
}) {
  const { page, playlist } = props;
  const remote = useRemote();
  const { edit } = usePlaylistEdit(playlist);
  const share = useControl();
  const sharing = page.guildId === null;
  const inThisServer = remote.target?.guildId === remote.guildId;
  const players =
    remote.room?.players.filter((player) => player.current !== null) ?? [];
  return (
    <div className="playlist-tools">
      <div className="btn-row">
        <span className="playlist-tool">
          <button
            type="button"
            className="btn"
            aria-busy={share.pending}
            aria-disabled={share.pending}
            onClick={() => {
              if (share.pending) return;
              edit(
                share,
                { action: sharing ? "publish" : "private" },
                sharing
                  ? "Shared with this server."
                  : "Only you can see this playlist now.",
              );
            }}
          >
            {sharing ? "Share with this server" : "Make private"}
          </button>
          <ChangeStatus control={share} onRefresh={playlist.refresh} />
        </span>
        {inThisServer &&
          players.map((player) => (
            <AddCurrent
              key={player.slot}
              player={player}
              several={players.length > 1}
              playlist={playlist}
            />
          ))}
        <DeleteButton playlist={playlist} name={page.name} />
      </div>
    </div>
  );
}
