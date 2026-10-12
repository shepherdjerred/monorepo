import { useEffect, useState } from "react";
import type { z } from "zod";
import { SportsResultsSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { api } from "./api.ts";
import { MediaRow, type MediaListProps } from "./media-row.tsx";
import { useRouteState } from "./route-state.ts";

export function Sports(props: MediaListProps) {
  const route = useRouteState();
  const search = route.params.get("q") ?? "";
  const provider = route.params.get("provider") ?? "streameast";
  const [query, setQuery] = useState(search);
  useEffect(() => {
    setQuery(search);
  }, [search]);
  const [refresh, setRefresh] = useState(0);
  const [events, setEvents] = useState<z.infer<typeof SportsResultsSchema>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.sportsEnabled) return;
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(40_000);
    async function load() {
      setLoading(true);
      setError("");
      setEvents([]);
      try {
        const next = await api(
          "/api/sports?" +
            new URLSearchParams({
              guildId: props.guildId,
              query: search,
              provider,
            }).toString(),
          SportsResultsSchema,
          { signal: AbortSignal.any([controller.signal, deadline]) },
        );
        if (!controller.signal.aborted) setEvents(next);
      } catch (error_) {
        if (!controller.signal.aborted)
          setError(
            deadline.aborted
              ? "Live sports took too long to load. Please refresh and try again."
              : error_ instanceof Error
                ? error_.message
                : "Live sports listings are unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, [props.guildId, props.sportsEnabled, search, provider, refresh]);

  if (!props.sportsEnabled)
    return (
      <div className="empty">
        <h3>Live sports are not enabled here yet</h3>
        <p>Choose a server with sports streaming enabled to browse events.</p>
      </div>
    );

  return (
    <>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          route.update({ q: query.trim() });
          setRefresh((value) => value + 1);
        }}
      >
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search live sports"
            placeholder="A team, league, or matchup…"
            value={query}
            maxLength={300}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <select
          aria-label="Sports provider"
          value={provider}
          onChange={(event) => {
            route.update({ provider: event.target.value });
          }}
        >
          <option value="streameast">StreamEast</option>
          <option value="tvsportslive">TVSportsLive</option>
          <option value="auto">All sports providers</option>
        </select>
        <button className="primary" disabled={loading}>
          {loading ? "Finding games…" : "Search"}
        </button>
      </form>
      <div className="result-heading">
        <span>
          {loading
            ? "Loading today’s events…"
            : String(events.length) +
              (events.length === 1 ? " event today" : " events today")}
        </span>
        <button
          disabled={loading}
          onClick={() => {
            setRefresh((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>
      <p className="sports-note">
        Queue live events for your voice channel. Upcoming games become playable
        when they start.
      </p>
      {error !== "" && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="media-rows">
        {events.map((event) => (
          <MediaRow
            key={event.id}
            {...props}
            title={event.title}
            detail={event.provider + " · " + eventTime(event)}
            selection={{ kind: "sports", id: event.id }}
            {...(event.sportsArtwork === undefined
              ? {}
              : { sportsArtwork: event.sportsArtwork })}
            available={event.status !== "scheduled"}
            {...(event.status === "unknown"
              ? {}
              : {
                  badge:
                    event.status === "live"
                      ? ("Live" as const)
                      : ("Upcoming" as const),
                })}
          />
        ))}
      </div>
      {!loading && error === "" && events.length === 0 && (
        <div className="empty">
          <h3>No games found</h3>
          <p>Try another team or provider, or refresh closer to game time.</p>
        </div>
      )}
    </>
  );
}

function eventTime(event: z.infer<typeof SportsResultsSchema>[number]): string {
  if (event.startsAt === null)
    return event.status === "live" ? "Live now" : "Start time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.startsAt));
}
