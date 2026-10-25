import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { z } from "zod";
import {
  PlaylistListSchema,
  PlaylistPageSchema,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { MusicFeaturesSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { api, playerCommand } from "./api.ts";
import { MusicPagination } from "./music.tsx";
import { useRouteState, pageOffset } from "./route-state.ts";
import { MediaActions, type MediaListProps } from "./media-row.tsx";
import {
  PlaylistEditor,
  PlaylistItems,
  PlaylistList,
  type Mutation,
} from "./playlist-components.tsx";

export function Playlists(props: MediaListProps) {
  const route = useRouteState();
  const id = route.params.get("playlist") ?? "";
  const offset = pageOffset(route.params.get("offset"));
  const scope = route.params.get("scope") === "server" ? "server" : "mine";
  const [list, setList] = useState<z.infer<typeof PlaylistListSchema>>([]);
  const [page, setPage] = useState<z.infer<typeof PlaylistPageSchema> | null>(
    null,
  );
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [copyName, setCopyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPage(null);
    setEnabled(null);
    void (async () => {
      try {
        const features = await api(
          "/api/music/features?guildId=" + props.guildId,
          MusicFeaturesSchema,
          { signal: controller.signal },
        );
        setEnabled(features.playlists);
        if (!features.playlists) return;
        const params = new URLSearchParams({
          guildId: props.guildId,
          scope,
          offset: String(offset),
        });
        if (id === "") {
          const result = await api(
            "/api/playlists?" + params.toString(),
            PlaylistListSchema,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) setList(result);
        } else {
          params.set("id", id);
          const result = await api(
            "/api/playlists?" + params.toString(),
            PlaylistPageSchema,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setPage(result);
            setName(result.name);
            setCopyName(result.name + " copy");
          }
        }
      } catch (error_) {
        if (!controller.signal.aborted)
          setError(
            error_ instanceof Error ? error_.message : "Playlists unavailable.",
          );
      }
    })();
    return () => {
      controller.abort();
    };
  }, [props.guildId, id, scope, refresh, offset]);
  async function mutate(change: Mutation) {
    if (props.csrfToken === undefined) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const init = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": props.csrfToken,
        },
        body: JSON.stringify({ ...change, guildId: props.guildId }),
      };
      if (change.action === "delete") {
        await api("/api/playlists", CommandResultSchema, init);
        route.update({ playlist: "" });
        setNotice("Playlist deleted.");
      } else {
        const result = await api("/api/playlists", PlaylistPageSchema, init);
        setPage(result);
        setName(result.name);
        route.update({ playlist: result.id, offset: "" });
        setNotice("Playlist saved.");
      }
      setRefresh((value) => value + 1);
    } catch (error_) {
      setError(
        error_ instanceof Error
          ? error_.message
          : "The playlist could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  const playback =
    props.snapshot?.channel == null
      ? undefined
      : playerCommand(
          { action: "volume", percent: 100 },
          props.guildId,
          props.snapshot,
        );
  const mutation = (change: Mutation) => {
    void mutate({
      ...(page === null ? {} : { id: page.id, revision: page.revision }),
      ...change,
    });
  };
  return (
    <div className="playlists-browser">
      <p className="muted">
        Keep your favorites close. Share a playlist with your server.
      </p>
      <nav className="playlist-scopes" aria-label="Playlist visibility">
        <button
          aria-pressed={scope === "mine"}
          onClick={() => {
            route.update({ scope: "mine", playlist: "", offset: "" });
          }}
        >
          Mine
        </button>
        <button
          aria-pressed={scope === "server"}
          onClick={() => {
            route.update({ scope: "server", playlist: "", offset: "" });
          }}
        >
          This server
        </button>
        <Link to={"/music?guild=" + props.guildId}>Find music →</Link>
      </nav>
      {enabled === null && error === "" && (
        <p role="status">Loading playlists…</p>
      )}
      {enabled === false && (
        <p>Saved playlists are not available in this server yet.</p>
      )}
      {error !== "" && (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setRefresh((value) => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {notice !== "" && <p role="status">{notice}</p>}
      {enabled === true && id === "" && (
        <PlaylistList
          {...props}
          list={list}
          scope={scope}
          name={name}
          setName={setName}
          busy={busy}
          playback={playback}
          mutation={mutation}
        />
      )}
      {page !== null && (
        <>
          <button
            onClick={() => {
              route.update({ playlist: "" });
            }}
          >
            ← Playlists
          </button>
          <div className="album-heading">
            <div className="playlist-cover" aria-hidden="true">
              ♫
            </div>
            <div>
              <p className="eyebrow">
                {page.guildId === null ? "PRIVATE PLAYLIST" : "SERVER PLAYLIST"}
              </p>
              <h2>{page.name}</h2>
              <p>{page.count} item(s)</p>
            </div>
          </div>
          <MediaActions
            {...props}
            busy={props.busy || busy}
            selection={{
              kind: "playlist",
              id: page.id,
              revision: page.revision,
            }}
            title={page.name}
          />
          <PlaylistEditor
            page={page}
            busy={busy}
            mutation={mutation}
            name={name}
            setName={setName}
            copyName={copyName}
            setCopyName={setCopyName}
            playback={playback}
          />
          <PlaylistItems
            {...props}
            page={page}
            busy={busy}
            mutation={mutation}
          />
          <MusicPagination
            offset={page.offset ?? 0}
            step={50}
            more={(page.offset ?? 0) + 50 < page.count}
            busy={busy}
            update={route.update}
          />
          {page.items.length === 0 && (
            <p>Add songs from Music, or add the currently playing song.</p>
          )}
        </>
      )}
    </div>
  );
}
