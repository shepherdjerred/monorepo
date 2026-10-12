import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { z } from "zod";
import { HistoryPageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { api, elapsed } from "./api.ts";
import { useRouteState, pageOffset } from "./route-state.ts";
import { MediaRow, type MediaListProps } from "./media-row.tsx";
import { CalendarTime } from "./attribution.tsx";

export function History(props: MediaListProps) {
  const route = useRouteState();
  const query = route.params.get("q") ?? "";
  const visibility = route.params.get("visibility") ?? "mine";
  const provider = route.params.get("provider") ?? "";
  const offset = pageOffset(route.params.get("offset"));
  const [draft, setDraft] = useState(query);
  const [page, setPage] = useState<z.infer<typeof HistoryPageSchema> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(query);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    if (props.historyEnabled !== true) return;
    setLoading(true);
    setError("");
    setPage(null);
    async function load() {
      try {
        const next = await api(
          "/api/history?" +
            new URLSearchParams({
              guildId: props.guildId,
              visibility,
              provider,
              query,
              offset: String(offset),
            }).toString(),
          HistoryPageSchema,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setPage(next);
      } catch (caughtError) {
        if (!controller.signal.aborted)
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "History unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, [
    props.guildId,
    props.historyEnabled,
    visibility,
    provider,
    query,
    offset,
  ]);
  if (props.historyEnabled === undefined)
    return <p className="muted">Checking playback history…</p>;
  if (!props.historyEnabled)
    return (
      <div className="empty">
        <h3>History is not enabled here yet</h3>
        <p>Choose a server with playback history enabled.</p>
      </div>
    );
  return (
    <>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          route.update({ q: draft.trim(), offset: "" });
        }}
      >
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            name="q"
            aria-label="Search playback history"
            placeholder="Find a past play…"
            maxLength={300}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </label>
        <select
          aria-label="History visibility"
          value={visibility}
          onChange={(event) => {
            route.update({ visibility: event.target.value, offset: "" });
          }}
        >
          <option value="mine">Mine</option>
          <option value="server">Server</option>
        </select>
        <select
          aria-label="History source"
          value={provider}
          onChange={(event) => {
            route.update({ provider: event.target.value, offset: "" });
          }}
        >
          <option value="">All sources</option>
          <option value="local">Plex</option>
          <option value="youtube">YouTube</option>
          <option value="streameast">StreamEast</option>
          <option value="tvsportslive">TVSportsLive</option>
          <option value="url">Other links</option>
        </select>
        <button className="primary" disabled={loading}>
          Search
        </button>
      </form>
      <div className="result-heading">
        <span>
          {loading
            ? "Loading recent plays…"
            : String(page?.total ?? 0) + " plays"}
        </span>
        <span>{visibility === "mine" ? "YOUR HISTORY" : "SERVER HISTORY"}</span>
      </div>
      {error !== "" && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="media-rows">
        {page?.items.map((item) => (
          <div key={item.id}>
            <p className="history-time">
              <CalendarTime time={item.playedAt} /> · {item.requester?.name}
              {item.outcome === null ? "" : " · " + item.outcome}
            </p>
            <MediaRow
              {...props}
              title={item.title}
              detail={[
                item.provider,
                elapsed(item.durationSeconds),
                item.replayAvailable ? "" : "Event ended / unavailable",
              ]
                .filter(Boolean)
                .join(" · ")}
              selection={{ kind: "history", id: item.id }}
              available={item.replayAvailable}
              landscape={item.provider === "youtube"}
              {...(item.provider === "local" ||
              item.provider === "streameast" ||
              item.provider === "tvsportslive"
                ? { preferredChannel: 2 }
                : {})}
              {...(item.artworkUrl === undefined
                ? {}
                : { artworkUrl: item.artworkUrl })}
              {...(item.sportsArtwork === undefined
                ? {}
                : { sportsArtwork: item.sportsArtwork })}
            />
          </div>
        ))}
      </div>
      {page?.items.length === 0 && (
        <div className="empty">
          <h3>No plays found</h3>
          <p>Try another filter, or play something together.</p>
        </div>
      )}
      {page !== null && page.total > 50 && (
        <nav className="pagination" aria-label="History pages">
          {offset > 0 && (
            <Link to={route.href({ offset: String(Math.max(0, offset - 50)) })}>
              Previous
            </Link>
          )}
          <span>
            {Math.min(offset + 1, page.total)}–
            {Math.min(offset + 50, page.total)} of {page.total}
          </span>
          {offset + 50 < page.total && (
            <Link to={route.href({ offset: String(offset + 50) })}>Next</Link>
          )}
        </nav>
      )}
    </>
  );
}
