import { useState } from "react";
import { MusicMatchesSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import type { MusicMatch } from "@shepherdjerred/streambot/music/contracts.ts";
import {
  apiRequest,
  apiUrl,
} from "@shepherdjerred/streambot/web/client/api.ts";
import { Artwork } from "@shepherdjerred/streambot/web/client/media/artwork.tsx";
import { PlayActions } from "@shepherdjerred/streambot/web/client/media/play-actions.tsx";
import { itemDetail } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
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
 * One saved item: the shared row with its play buttons, and for the owner Move up, Move down,
 * Remove and Choose video. Each button has its own pending state and its own status line.
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
  const detail = itemDetail(item);
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
  return (
    <li className="row entry">
      <Artwork item={item} shape="thumb" />
      <div className="row-text">
        <span className="row-title">{item.title}</span>
        <span className="row-detail">{detail}</span>
      </div>
      <PlayActions item={item} />
      {props.owned && (
        <div className="entry-edit btn-row">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-small"
            aria-label={"Move " + item.title + " up"}
            aria-disabled={index === 0 || controls.up.pending}
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
            aria-disabled={index === count - 1 || controls.down.pending}
            aria-busy={controls.down.pending}
            onClick={() => {
              move("down");
            }}
          >
            <span aria-hidden="true">↓</span>
          </button>
          {entry.music !== undefined && entry.selectionId !== undefined && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              aria-disabled={controls.match.pending}
              aria-busy={controls.match.pending}
              onClick={findVideos}
            >
              {controls.match.pending ? "Finding…" : "Choose video"}
              <span className="visually-hidden">: {item.title}</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-small"
            aria-disabled={controls.remove.pending}
            aria-busy={controls.remove.pending}
            onClick={() => {
              if (controls.remove.pending) return;
              setLast("remove");
              edit(
                controls.remove,
                { action: "remove", itemId: entry.id },
                "Removed.",
                props.onRemoved,
              );
            }}
          >
            {controls.remove.pending ? "Removing…" : "Remove"}
            <span className="visually-hidden">: {item.title}</span>
          </button>
        </div>
      )}
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
    </li>
  );
}
