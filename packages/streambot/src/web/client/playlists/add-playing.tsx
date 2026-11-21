import { PlaylistPageSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { RowMenu } from "@shepherdjerred/streambot/web/client/media/row-menu.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ChangeStatus } from "./change-status.tsx";
import { mutationTask, playbackFor } from "./playlist-api.ts";
import { playlistRequest } from "./playlist-model.ts";
import type { PlaylistHandle } from "./use-playlist.ts";

const NOTHING_PLAYING = {
  status: 0,
  code: "invalid_request",
  message: "Nothing is playing there any more.",
  reference: null,
};

const GLYPH = { listen: "♪ Listening", watch: "▶ Watching" } as const;

/**
 * Adds what the viewer's room is playing to this playlist. One control: with one player playing,
 * the button adds it and names it; with several, it opens a menu of what plays where. The server
 * reads the queue from the room, so the viewer has to be in the server being browsed.
 */
export function AddPlaying(props: {
  players: readonly WebRoomPlayer[];
  playlist: PlaylistHandle;
}) {
  const remote = useRemote();
  const control = useControl();
  const [only] = props.players;
  if (only === undefined) return null;
  const add = (slot: number) => {
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
  };
  const title = (player: WebRoomPlayer) => player.current?.title ?? "this";
  return (
    <div className="add-playing">
      {props.players.length === 1 ? (
        <button
          type="button"
          className="btn btn-small"
          aria-busy={control.pending}
          aria-disabled={control.pending}
          onClick={() => {
            add(only.slot);
          }}
        >
          {control.pending ? "Adding…" : `Add “${title(only)}”`}
        </button>
      ) : (
        <RowMenu
          label="Add what's playing"
          triggerText={control.pending ? "Adding…" : "Add what's playing"}
          items={props.players.map((player) => ({
            key: String(player.slot),
            label: `${GLYPH[player.transport]}: ${title(player)}`,
            onSelect: () => {
              add(player.slot);
            },
          }))}
        />
      )}
      <ChangeStatus control={control} onRefresh={props.playlist.refresh} />
    </div>
  );
}
