import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { z } from "zod";
import {
  MusicPageSchema,
  MusicAlbumSchema,
  MusicFeaturesSchema,
} from "@shepherdjerred/streambot/music/contracts.ts";
import { api, elapsed } from "./api.ts";
import { useRouteState, pageOffset } from "./route-state.ts";
import type { MediaListProps } from "./media-row.tsx";
import { Artwork } from "./artwork.tsx";
import { MusicActions } from "./music-actions.tsx";

function musicLocation(params: URLSearchParams) {
  const query = params.get("q") ?? "";
  const type = params.get("type") ?? "all";
  const artist = params.get("artist") ?? "";
  const albumId = params.get("album") ?? "";
  const release = params.get("release") ?? "";
  const offset = pageOffset(params.get("offset"));
  return { query, type, artist, albumId, release, offset };
}

export function Music(props: MediaListProps) {
  const route = useRouteState();
  const { query, type, artist, albumId, release, offset } = musicLocation(
    route.params,
  );
  const [draft, setDraft] = useState(query);
  const [page, setPage] = useState<z.infer<typeof MusicPageSchema> | null>(
    null,
  );
  const [album, setAlbum] = useState<z.infer<typeof MusicAlbumSchema> | null>(
    null,
  );
  const [features, setFeatures] = useState<z.infer<
    typeof MusicFeaturesSchema
  > | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setDraft(query);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setFeatures(null);
    void (async () => {
      try {
        const value = await api(
          "/api/music/features?guildId=" + props.guildId,
          MusicFeaturesSchema,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setFeatures(value);
      } catch (error_) {
        if (!controller.signal.aborted)
          setError(
            error_ instanceof Error ? error_.message : "Music is unavailable.",
          );
      }
    })();
    return () => {
      controller.abort();
    };
  }, [props.guildId, retry]);
  useEffect(() => {
    if (features?.catalog !== true) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPage(null);
    setAlbum(null);
    const params = new URLSearchParams({
      guildId: props.guildId,
      query,
      type,
      offset: String(offset),
    });
    if (artist !== "") params.set("artist", artist);
    if (albumId !== "") params.set("album", albumId);
    if (release !== "") params.set("release", release);
    void (async () => {
      try {
        if (albumId === "") {
          const value = await api(
            "/api/music/catalog?" + params.toString(),
            MusicPageSchema,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) setPage(value);
        } else {
          const value = await api(
            "/api/music/album?" + params.toString(),
            MusicAlbumSchema,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) setAlbum(value);
        }
      } catch (error_) {
        if (!controller.signal.aborted)
          setError(
            error_ instanceof Error
              ? error_.message
              : "Music could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [
    props.guildId,
    query,
    type,
    artist,
    albumId,
    release,
    offset,
    features?.catalog,
    retry,
  ]);
  const artwork = (id: string) =>
    "/api/music/artwork?" +
    new URLSearchParams({ guildId: props.guildId, id }).toString();
  return (
    <div className="music-browser">
      <p className="muted">
        Find the artist. Choose the album. Play the recording together.
      </p>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          route.update({
            q: draft.trim(),
            artist: "",
            artistName: "",
            album: "",
            release: "",
            offset: "",
          });
        }}
      >
        <label className="filter-label">
          Search music
          <input
            type="search"
            maxLength={300}
            value={draft}
            placeholder="Artist, album, or song"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </label>
        <label className="filter-label">
          Show
          <select
            value={type}
            onChange={(event) => {
              route.update({
                type: event.target.value,
                offset: "",
                artist: "",
                album: "",
                release: "",
              });
            }}
          >
            <option value="all">Everything</option>
            <option value="artist">Artists</option>
            <option value="album">Albums</option>
            <option value="song">Songs</option>
          </select>
        </label>
        <button type="submit" disabled={loading}>
          Search
        </button>
      </form>
      <p>
        <Link to={"/search?guild=" + props.guildId}>
          Paste a Spotify or YouTube link
        </Link>{" "}
        · <Link to={"/playlists?guild=" + props.guildId}>Your playlists</Link>
      </p>
      {artist !== "" && (
        <p>
          <button
            onClick={() => {
              route.update({
                artist: "",
                artistName: "",
                album: "",
                release: "",
                offset: "",
              });
            }}
          >
            ← Search results
          </button>{" "}
          <strong>{route.params.get("artistName")}</strong>
        </p>
      )}
      {albumId !== "" && (
        <button
          onClick={() => {
            route.update({ album: "", release: "", offset: "" });
          }}
        >
          ← Albums
        </button>
      )}
      {!props.canPlay && (
        <p className="muted">
          Browse and save freely. Join a Discord voice channel to play.
        </p>
      )}
      {features?.catalog === false && (
        <p>Music browsing is not available in this server yet.</p>
      )}
      {loading && <p role="status">Loading music…</p>}
      {error !== "" && (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {album !== null && (
        <>
          <div className="album-heading">
            <Artwork url={artwork(album.id)} />
            <div>
              <p className="eyebrow">ALBUM</p>
              <h2>{album.title}</h2>
              <p>{album.artist}</p>
            </div>
          </div>
          <label className="filter-label">
            Edition
            <select
              value={album.releaseId}
              onChange={(event) => {
                route.update({ release: event.target.value, offset: "" });
              }}
            >
              {album.editions.map((edition) => (
                <option key={edition.id} value={edition.id}>
                  {edition.label}
                </option>
              ))}
            </select>
          </label>
          {album.selectionId !== undefined && (
            <MusicActions
              {...props}
              title={album.title}
              selectionId={album.selectionId}
            />
          )}
          <ol className="music-tracks" start={(album.offset ?? 0) + 1}>
            {album.tracks.map((track, index) => (
              <li
                key={String(index) + track.id}
                value={(album.offset ?? 0) + index + 1}
              >
                <div>
                  <strong>{track.title}</strong>
                  <p className="muted">
                    {track.artists.join(", ")} ·{" "}
                    {elapsed(track.durationSeconds ?? null)}
                  </p>
                </div>
                {album.selections?.[index] !== undefined && (
                  <MusicActions
                    {...props}
                    title={track.title}
                    selectionId={album.selections[index]}
                    matchable
                  />
                )}
              </li>
            ))}
          </ol>
          <MusicPagination
            offset={album.offset ?? 0}
            step={50}
            more={
              (album.offset ?? 0) + 50 < (album.total ?? album.tracks.length)
            }
            busy={loading}
            update={route.update}
          />
        </>
      )}
      {page !== null && (
        <>
          {page.items.length === 0 && (
            <p>
              {query === "" && artist === ""
                ? "Start with an artist, an album, or a song you love."
                : "No music matched this search."}
            </p>
          )}
          <div className="music-grid">
            {page.items.map((item) => (
              <article
                className={"music-card " + item.kind}
                key={item.kind + item.id}
              >
                {item.kind === "album" && item.artworkId !== undefined && (
                  <Artwork url={artwork(item.artworkId)} />
                )}
                <p className="eyebrow">{item.kind}</p>
                <h2>{item.title}</h2>
                <p>{item.subtitle}</p>
                {item.date !== undefined && (
                  <p className="muted">{item.date}</p>
                )}
                {item.kind === "artist" ? (
                  <button
                    onClick={() => {
                      route.update({
                        artist: item.id,
                        artistName: item.title,
                        album: "",
                        offset: "",
                      });
                    }}
                  >
                    Browse releases →
                  </button>
                ) : item.kind === "album" ? (
                  <button
                    onClick={() => {
                      route.update({ album: item.id, release: "", offset: "" });
                    }}
                  >
                    Browse tracks →
                  </button>
                ) : item.selectionId === undefined ? null : (
                  <MusicActions
                    {...props}
                    title={item.title}
                    selectionId={item.selectionId}
                    matchable
                  />
                )}
              </article>
            ))}
          </div>
          <MusicPagination
            offset={offset}
            step={20}
            more={page.hasMore ?? offset + 20 < page.total}
            busy={loading}
            update={route.update}
          />
        </>
      )}
      <p className="music-attribution">
        Catalog metadata: <a href="https://musicbrainz.org">MusicBrainz</a>.
        Album artwork:{" "}
        <a href="https://coverartarchive.org">Cover Art Archive</a>. Playback
        sources: YouTube.
      </p>
    </div>
  );
}

export function MusicPagination({
  offset,
  step,
  more,
  busy,
  update,
}: {
  offset: number;
  step: number;
  more: boolean;
  busy: boolean;
  update: (changes: Record<string, string>) => void;
}) {
  return (
    <div className="pagination">
      <button
        disabled={offset === 0 || busy}
        onClick={() => {
          update({ offset: String(Math.max(0, offset - step)) });
        }}
      >
        Previous
      </button>
      <button
        disabled={busy || !more}
        onClick={() => {
          update({ offset: String(offset + step) });
        }}
      >
        Next
      </button>
    </div>
  );
}
