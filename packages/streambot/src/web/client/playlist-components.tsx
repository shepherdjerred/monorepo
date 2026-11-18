import { useId } from "react";
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
import { Artwork } from "./artwork.tsx";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import {
  PlaylistAppendImportForm,
  PlaylistImportForm,
} from "./playlist-import-forms.tsx";
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
          <Artwork
            url={musicArtworkUrl(item.music, props.guildId)}
            className="track-artwork"
          />
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
                type="button"
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
                type="button"
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
                type="button"
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
  const renameHeadingId = useId();
  const renameInputId = useId();
  const shareInputId = useId();
  const shareHintId = useId();
  const copyHeadingId = useId();
  const copyInputId = useId();
  return (
    <>
      {page.owned && (
        <div className="playlist-editor">
          <form
            aria-labelledby={renameHeadingId}
            method="post"
            action="/api/playlists"
            className="filters"
            onSubmit={(event) => {
              event.preventDefault();
              mutation({ action: "rename", name: name.trim() });
            }}
          >
            <h3 id={renameHeadingId} className="playlist-form-heading">
              Rename playlist
            </h3>
            <div className="filter-label">
              <label htmlFor={renameInputId}>Name</label>
              <input
                id={renameInputId}
                name="name"
                type="text"
                required
                value={name}
                maxLength={100}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </div>
            <button type="submit" disabled={busy}>
              Rename
            </button>
          </form>
          <PlaylistAppendImportForm
            key={page.revision}
            busy={busy}
            mutation={mutation}
          />
          <button
            type="button"
            disabled={busy || playback === undefined}
            onClick={() => {
              mutation({ action: "add", playback });
            }}
          >
            Add current song
          </button>
          {page.guildId === null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                mutation({ action: "publish" });
              }}
            >
              Share with this server
            </button>
          ) : (
            <button
              type="button"
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
              type="button"
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
        <div className="filter-label">
          <label htmlFor={shareInputId}>Share link</label>
          <small id={shareHintId}>
            Only signed-in members of this server can open it.
          </small>
          <input
            id={shareInputId}
            name="shareUrl"
            type="url"
            readOnly
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={shareHintId}
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
        </div>
      )}
      <form
        aria-labelledby={copyHeadingId}
        method="post"
        action="/api/playlists"
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          mutation({ action: "copy", name: copyName.trim() });
        }}
      >
        <h3 id={copyHeadingId} className="playlist-form-heading">
          Copy to your playlists
        </h3>
        <div className="filter-label">
          <label htmlFor={copyInputId}>Name for your private copy</label>
          <input
            id={copyInputId}
            name="copyName"
            type="text"
            required
            value={copyName}
            maxLength={100}
            onChange={(event) => {
              setCopyName(event.target.value);
            }}
          />
        </div>
        <button type="submit" disabled={busy}>
          Make a copy
        </button>
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
    initialImportUrl: string;
    busy: boolean;
    playback: unknown;
    mutation: (change: Mutation) => void;
  },
) {
  const {
    list,
    scope,
    name,
    setName,
    initialImportUrl,
    busy,
    playback,
    mutation,
  } = props;
  const route = useRouteState();
  const createHeadingId = useId();
  const createNameId = useId();
  return (
    <>
      <div className="playlist-forms">
        <form
          aria-labelledby={createHeadingId}
          method="post"
          action="/api/playlists"
          className="playlist-create filters"
          onSubmit={(event) => {
            event.preventDefault();
            mutation({ action: "create", name: name.trim() });
          }}
        >
          <h2 id={createHeadingId} className="playlist-form-heading">
            Create or save a playlist
          </h2>
          <div className="filter-label">
            <label htmlFor={createNameId}>Playlist name</label>
            <input
              id={createNameId}
              name="name"
              type="text"
              required
              value={name}
              maxLength={100}
              placeholder="A good evening"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <button type="submit" disabled={busy}>
            Create private playlist
          </button>
          <button
            type="button"
            disabled={busy || playback === undefined}
            onClick={(event) => {
              if (
                event.currentTarget.form !== null &&
                !event.currentTarget.form.reportValidity()
              ) {
                return;
              }
              mutation({ action: "save", name: name.trim(), playback });
            }}
          >
            Save current queue
          </button>
        </form>
        <PlaylistImportForm
          key={initialImportUrl}
          initialUrl={initialImportUrl}
          busy={busy}
          mutation={mutation}
        />
      </div>
      <div className="music-grid">
        {list.map((playlist) => (
          <article className="music-card" key={playlist.id}>
            <Artwork url={musicArtworkUrl(playlist.cover, props.guildId)} />
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
            ? "Your playlists start here. Create one, import a link, or save the queue explicitly."
            : "No playlists have been shared with this server yet."}
        </p>
      )}
    </>
  );
}
