import { useState } from "react";
import type { z } from "zod";
import { MusicMatchesSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import {
  PlaylistListSchema,
  PlaylistPageSchema,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { api } from "./api.ts";
import { MediaActions, type MediaListProps } from "./media-row.tsx";

export function MusicActions(
  props: MediaListProps & {
    selectionId: string;
    title: string;
    matchable?: boolean;
    matched?: boolean;
    saveMatch?: ((selectionId: string) => void) | undefined;
  },
) {
  const [matches, setMatches] = useState<z.infer<
    typeof MusicMatchesSchema
  > | null>(null);
  const [placement, setPlacement] = useState<"queue" | "next" | "now">("queue");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function choose(next: "queue" | "next" | "now", force = false) {
    if (props.matchable !== true || (!force && props.matched === true)) {
      props.play({ kind: "music", id: props.selectionId }, next);
      return;
    }
    if (!force) setSaving(false);
    setLoading(true);
    setError("");
    setPlacement(next);
    try {
      const results = await api(
        "/api/music/matches?" +
          new URLSearchParams({
            guildId: props.guildId,
            selectionId: props.selectionId,
          }).toString(),
        MusicMatchesSchema,
      );
      const first = results.find((match) => match.confident);
      if (!force && first?.selectionId !== undefined)
        props.play({ kind: "music", id: first.selectionId }, next);
      else setMatches(results);
    } catch (error_) {
      setError(
        error_ instanceof Error
          ? error_.message
          : "YouTube matches are unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="music-actions">
      <MediaActions
        {...props}
        busy={props.busy || loading}
        selection={{ kind: "music", id: props.selectionId }}
        preferredChannel={1}
        play={(_selection, next) => {
          void choose(next);
        }}
      />
      {props.matchable === true && (
        <button
          className="text-button"
          disabled={loading}
          onClick={() => {
            setSaving(props.saveMatch !== undefined);
            void choose("queue", true);
          }}
        >
          Choose video
        </button>
      )}
      <AddToPlaylist {...props} />
      {error !== "" && <p role="alert">{error}</p>}
      {matches !== null && (
        <section
          className="match-picker"
          aria-label={"YouTube matches for " + props.title}
        >
          <h3>Choose a recording</h3>
          {matches.length === 0 && <p>No matching videos were found.</p>}
          {matches.map((match) => (
            <button
              key={match.url}
              disabled={
                (!saving && !props.canPlay) ||
                props.busy ||
                match.selectionId === undefined
              }
              onClick={() => {
                if (match.selectionId !== undefined) {
                  if (saving) props.saveMatch?.(match.selectionId);
                  else
                    props.play(
                      { kind: "music", id: match.selectionId },
                      placement,
                    );
                }
                setMatches(null);
                setSaving(false);
              }}
            >
              {saving ? "Save: " : ""}
              {match.title}
              <small>{match.channel}</small>
            </button>
          ))}
          {!props.canPlay && <p>Join a voice channel to play a recording.</p>}
          <button
            onClick={() => {
              setMatches(null);
            }}
          >
            Close
          </button>
        </section>
      )}
    </div>
  );
}

export function AddToPlaylist(props: MediaListProps & { selectionId: string }) {
  const [playlists, setPlaylists] = useState<
    z.infer<typeof PlaylistListSchema>
  >([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setMessage("");
    try {
      setPlaylists(
        await api(
          "/api/playlists?" +
            new URLSearchParams({ guildId: props.guildId }).toString(),
          PlaylistListSchema,
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Playlists unavailable.",
      );
    }
  }
  async function add() {
    const playlist = playlists.find((item) => item.id === selected);
    if (playlist === undefined || props.csrfToken === undefined) return;
    setBusy(true);
    try {
      const result = await api("/api/playlists", PlaylistPageSchema, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": props.csrfToken,
        },
        body: JSON.stringify({
          action: "add",
          guildId: props.guildId,
          id: playlist.id,
          revision: playlist.revision,
          selectionId: props.selectionId,
        }),
      });
      setMessage("Added to " + result.name + ".");
      await load();
      setMessage("Added to " + result.name + ".");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save this song.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="playlist-add"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>Add to playlist</summary>
      <label>
        Your playlist
        <select
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
          }}
        >
          <option value="">Choose a playlist</option>
          {playlists.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || selected === "" || props.csrfToken === undefined}
        onClick={() => {
          void add();
        }}
      >
        Add
      </button>
      {playlists.length === 0 && (
        <a href={"/playlists?guild=" + props.guildId}>Create a playlist</a>
      )}
      {message !== "" && <p role="status">{message}</p>}
    </details>
  );
}
