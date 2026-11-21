import { useState } from "react";
import { MusicMatchesSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import type { MusicMatch } from "@shepherdjerred/streambot/music/contracts.ts";
import {
  apiRequest,
  apiUrl,
} from "@shepherdjerred/streambot/web/client/api.ts";
import { PlayActions } from "@shepherdjerred/streambot/web/client/media/play-actions.tsx";
import { MediaRow } from "@shepherdjerred/streambot/web/client/media/media-row.tsx";
import type { MenuItem } from "@shepherdjerred/streambot/web/client/media/row-menu.tsx";
import { ConfirmButton } from "@shepherdjerred/streambot/web/client/room/confirm-button.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import {
  useControl,
  type Control,
} from "@shepherdjerred/streambot/web/client/use-control.ts";
import { ChangeStatus } from "./change-status.tsx";
import {
  entryItem,
  movePosition,
  type PlaylistEntry,
} from "./playlist-model.ts";
import type { PlaylistHandle } from "./use-playlist.ts";
import { usePlaylistEdit } from "./use-playlist-edit.ts";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

type Key = "up" | "down" | "remove" | "match" | "pick";

/** The videos that could stand in for a saved song, from which the owner pins one. */
function MatchPicker(props: {
  title: string;
  matches: readonly MusicMatch[];
  pending: boolean;
  onPick: (selectionId: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="match-picker" aria-label={"Videos for " + props.title}>
      {props.matches.length === 0 && (
        <p className="muted">No matching videos were found.</p>
      )}
      <ul className="match-list">
        {props.matches.map((match) => (
          <li key={match.url}>
            <button
              type="button"
              className="btn btn-ghost match-choice"
              aria-disabled={props.pending || match.selectionId === undefined}
              onClick={() => {
                if (match.selectionId !== undefined && !props.pending)
                  props.onPick(match.selectionId);
              }}
            >
              <span className="row-title">{match.title}</span>
              {match.channel !== undefined && (
                <span className="row-detail">{match.channel}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-small" onClick={props.onClose}>
        Close
      </button>
    </section>
  );
}

/**
 * One saved item: the shared row with its play buttons, and for the owner Move up, Move down and
 * Remove beside them, with Choose video in its `⋯` menu. Each has its own pending state, and the
 * edits share one status line under the row.
 */
export function PlaylistEntryRow(props: {
  entry: PlaylistEntry;
  index: number;
  count: number;
  owned: boolean;
  playlist: PlaylistHandle;
  onRemoved: () => void;
}) {
  const { entry, index, count, playlist } = props;
  const remote = useRemote();
  const { edit } = usePlaylistEdit(playlist);
  const controls: Record<Key, Control> = {
    up: useControl(),
    down: useControl(),
    remove: useControl(),
    match: useControl(),
    pick: useControl(),
  };
  const [last, setLast] = useState<Key | null>(null);
  const [matches, setMatches] = useState<readonly MusicMatch[] | null>(null);
  const listen = remote.room?.capabilities.listen === true;
  const item = entryItem(entry, remote.guildId, listen);
  const move = (key: "up" | "down") => {
    const position = movePosition(index, key, count);
    if (position === null || controls[key].pending) return;
    setLast(key);
    edit(
      controls[key],
      { action: "move", itemId: entry.id, position },
      "Moved " + key + ".",
    );
  };
  const findVideos = () => {
    if (entry.selectionId === undefined || controls.match.pending) return;
    const { selectionId } = entry;
    setLast("match");
    controls.match.run(async (signal) => {
      const result = await apiRequest(
        apiUrl("/api/music/matches", { guildId: remote.guildId, selectionId }),
        MusicMatchesSchema,
        { signal },
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      setMatches(result.data);
      return { ok: true, message: "" };
    });
  };
  const pick = (selectionId: string) => {
    setLast("pick");
    edit(
      controls.pick,
      { action: "match", itemId: entry.id, selectionId },
      "Video saved.",
      () => {
        setMatches(null);
      },
    );
  };
  const chooseVideo: readonly MenuItem[] =
    props.owned && entry.music !== undefined && entry.selectionId !== undefined
      ? [
          {
            key: "choose-video",
            label: controls.match.pending ? "Finding videos…" : "Choose video…",
            onSelect: findVideos,
          },
        ]
      : [];
  const edits = props.owned ? (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-small"
        aria-label={"Move " + item.title + " up"}
        disabled={index === 0 || controls.up.pending}
        aria-busy={controls.up.pending}
        onClick={() => {
          move("up");
        }}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-small"
        aria-label={"Move " + item.title + " down"}
        disabled={index === count - 1 || controls.down.pending}
        aria-busy={controls.down.pending}
        onClick={() => {
          move("down");
        }}
      >
        <span aria-hidden="true">↓</span>
      </button>
      <ConfirmButton
        label={"Remove " + item.title + " from this playlist"}
        confirm="Remove"
        className="btn btn-ghost btn-icon btn-small"
        pending={controls.remove.pending}
        onConfirm={() => {
          setLast("remove");
          edit(
            controls.remove,
            { action: "remove", itemId: entry.id },
            "Removed.",
            props.onRemoved,
          );
        }}
      >
        <span aria-hidden="true">✕</span>
      </ConfirmButton>
    </>
  ) : undefined;
  return (
    <MediaRow
      item={item}
      actions={
        <>
          <PlayActions
            item={item}
            extraMenuItems={chooseVideo}
            trailing={edits}
          />
          <div className="entry-extra">
            <ChangeStatus
              control={last === null ? null : controls[last]}
              onRefresh={playlist.refresh}
            />
            {matches !== null && (
              <MatchPicker
                title={item.title}
                matches={matches}
                pending={controls.pick.pending}
                onPick={pick}
                onClose={() => {
                  setMatches(null);
                }}
              />
            )}
          </div>
        </>
      }
    />
  );
}
