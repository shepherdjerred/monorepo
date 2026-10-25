import { Link } from "react-router";
import type { z } from "zod";
import type {
  PlaylistListSchema,
  PlaylistPageSchema,
  PlaylistMutationSchema,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { useRouteState } from "./route-state.ts";
import { MediaActions, type MediaListProps } from "./media-row.tsx";
import { MusicActions } from "./music-actions.tsx";
export type Mutation = Omit<z.infer<typeof PlaylistMutationSchema>, "guildId">;

export function PlaylistItems(
  props: MediaListProps & {
    page: z.infer<typeof PlaylistPageSchema>;
    busy: boolean;
    mutation: (change: Mutation) => void;
  },
) {
  const { page, busy, mutation } = props;
  return (
    <ol className="music-tracks" start={(page.offset ?? 0) + 1}>
      {page.items.map((item, index) => (
        <li key={item.id} value={(page.offset ?? 0) + index + 1}>
          <div>
            <strong>{item.title}</strong>
            {item.music !== undefined && (
              <p className="muted">{item.music.artists.join(", ")}</p>
            )}
          </div>
          {item.selectionId !== undefined && (
            <MusicActions
              {...props}
              title={item.title}
              selectionId={item.selectionId}
              matchable={item.music !== undefined}
              matched={item.matched === true}
              saveMatch={
                page.owned
                  ? (selectionId) => {
                      mutation({
                        action: "match",
                        itemId: item.id,
                        selectionId,
                      });
                    }
                  : undefined
              }
            />
          )}
          {page.owned && (
            <div className="row-actions">
              <button
                aria-label={"Move " + item.title + " up"}
                disabled={busy || index + (page.offset ?? 0) === 0}
                onClick={() => {
                  mutation({
                    action: "move",
                    itemId: item.id,
                    position: index + (page.offset ?? 0),
                  });
                }}
              >
                ↑
              </button>
              <button
                aria-label={"Move " + item.title + " down"}
                disabled={busy || index + (page.offset ?? 0) === page.count - 1}
                onClick={() => {
                  mutation({
                    action: "move",
                    itemId: item.id,
                    position: index + (page.offset ?? 0) + 2,
                  });
                }}
              >
                ↓
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  mutation({ action: "remove", itemId: item.id });
                }}
              >
                Remove
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function PlaylistEditor({
  page,
  busy,
  mutation,
  name,
  setName,
  copyName,
  setCopyName,
  playback,
}: {
  page: z.infer<typeof PlaylistPageSchema>;
  busy: boolean;
  mutation: (change: Mutation) => void;
  name: string;
  setName: (value: string) => void;
  copyName: string;
  setCopyName: (value: string) => void;
  playback: unknown;
}) {
  return (
    <>
      {" "}
      {page.owned && (
        <div className="playlist-editor">
          <form
            className="filters"
            onSubmit={(event) => {
              event.preventDefault();
              mutation({ action: "rename", name });
            }}
          >
            <label className="filter-label">
              Name
              <input
                value={name}
                maxLength={100}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <button disabled={busy || name.trim() === ""}>Rename</button>
          </form>
          <button
            disabled={busy || playback === undefined}
            onClick={() => {
              mutation({ action: "add", playback });
            }}
          >
            Add current song
          </button>
          {page.guildId === null ? (
            <button
              disabled={busy}
              onClick={() => {
                mutation({ action: "publish" });
              }}
            >
              Share with this server
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                mutation({ action: "private" });
              }}
            >
              Make private
            </button>
          )}
          <details>
            <summary>Delete playlist</summary>
            <p>
              This deletes the saved playlist. Playback already queued
              continues.
            </p>
            <button
              disabled={busy}
              onClick={() => {
                mutation({ action: "delete" });
              }}
            >
              Delete this playlist
            </button>
          </details>
        </div>
      )}
      {page.guildId !== null && (
        <label className="filter-label">
          Share link{" "}
          <input
            readOnly
            value={
              globalThis.location.origin +
              "/playlists?" +
              new URLSearchParams({
                guild: page.guildId,
                playlist: page.id,
              }).toString()
            }
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <small>Only signed-in members of this server can open it.</small>
        </label>
      )}
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          mutation({ action: "copy", name: copyName });
        }}
      >
        <label className="filter-label">
          Name for your private copy
          <input
            value={copyName}
            maxLength={100}
            onChange={(event) => {
              setCopyName(event.target.value);
            }}
          />
        </label>
        <button disabled={busy || copyName.trim() === ""}>Make a copy</button>
      </form>
    </>
  );
}

export function PlaylistList(
  props: MediaListProps & {
    list: z.infer<typeof PlaylistListSchema>;
    scope: string;
    name: string;
    setName: (value: string) => void;
    busy: boolean;
    playback: unknown;
    mutation: (change: Mutation) => void;
  },
) {
  const { list, scope, name, setName, busy, playback, mutation } = props;
  const route = useRouteState();
  return (
    <>
      <form
        className="playlist-create filters"
        onSubmit={(event) => {
          event.preventDefault();
          mutation({ action: "create", name });
        }}
      >
        <label className="filter-label">
          Playlist name
          <input
            value={name}
            maxLength={100}
            placeholder="A good evening"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <button type="submit" disabled={busy || name.trim() === ""}>
          Create private playlist
        </button>
        <button
          type="button"
          disabled={busy || playback === undefined || name.trim() === ""}
          onClick={() => {
            mutation({ action: "save", name, playback });
          }}
        >
          Save current queue
        </button>
      </form>
      <div className="music-grid">
        {list.map((playlist) => (
          <article className="music-card" key={playlist.id}>
            <p className="eyebrow">
              {playlist.guildId === null ? "PRIVATE" : "SERVER PLAYLIST"}
            </p>
            <h2>{playlist.name}</h2>
            <p>{playlist.count} item(s)</p>
            <Link to={route.href({ playlist: playlist.id })}>
              Open playlist →
            </Link>
            <MediaActions
              {...props}
              selection={{
                kind: "playlist",
                id: playlist.id,
                revision: playlist.revision,
              }}
              title={playlist.name}
            />
          </article>
        ))}
      </div>
      {list.length === 0 && (
        <p>
          {scope === "mine"
            ? "Your playlists start here. Create one or save the queue explicitly."
            : "No playlists have been shared with this server yet."}
        </p>
      )}
    </>
  );
}
