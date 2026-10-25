import { useEffect, useState } from "react";
import type { z } from "zod";
import { SportsResultsSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { api } from "./api.ts";
import { MediaRow, type MediaListProps } from "./media-row.tsx";
import { useRouteState } from "./route-state.ts";
import { SportsSchedules, scheduleRequest } from "./sports-schedules.tsx";

export function Sports(props: MediaListProps) {
  const route = useRouteState();
  const search = route.params.get("q") ?? "";
  const provider = route.params.get("provider") ?? "streameast";
  const league = route.params.get("league") ?? "";
  const range =
    route.params.get("range") ?? (provider === "lolesports" ? "week" : "today");
  const [message, setMessage] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
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
              league,
              range,
              timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
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
  }, [
    props.guildId,
    props.sportsEnabled,
    search,
    provider,
    league,
    range,
    refresh,
  ]);

  async function schedule(selectionId: string) {
    setScheduling(true);
    setError("");
    setMessage("");
    try {
      const result = await scheduleRequest("/api/sports/schedules", {
        guildId: props.guildId,
        selectionId,
      });
      setMessage(result.message);
      setScheduleRefresh((n) => n + 1);
    } catch (error_) {
      setError(
        error_ instanceof Error
          ? error_.message
          : "Could not schedule playback.",
      );
    } finally {
      setScheduling(false);
    }
  }

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
        className={
          "search-form" + (provider === "lolesports" ? " lol-search" : "")
        }
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
          <option value="lolesports">LoL Esports</option>
          <option value="auto">All sports providers</option>
        </select>
        {provider === "lolesports" && (
          <>
            <select
              aria-label="LoL competition"
              className="lol-league-filter"
              value={league}
              onChange={(e) => {
                route.update({ league: e.target.value });
              }}
            >
              <option value="">All major competitions</option>
              {["lck", "worlds", "msi", "first_stand", "lpl", "lec", "lcs"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase().replaceAll("_", " ")}
                  </option>
                ),
              )}
            </select>
            <select
              aria-label="Schedule window"
              value={range}
              onChange={(e) => {
                route.update({ range: e.target.value });
              }}
            >
              <option value="today">Today</option>
              <option value="week">Next seven days</option>
            </select>
          </>
        )}
        <button className="primary" disabled={loading}>
          {loading ? "Finding games…" : "Search"}
        </button>
      </form>
      <div className="result-heading">
        <span>
          {loading
            ? "Loading events…"
            : String(events.length) +
              (events.length === 1 ? " event" : " events")}
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
      {message !== "" && <p role="status">{message}</p>}
      <div className="media-rows">
        {events.map((event) => (
          <MediaRow
            key={event.id}
            {...props}
            busy={props.busy || scheduling}
            {...(event.canSchedule === true
              ? {
                  onSchedule: () => {
                    void schedule(event.id);
                  },
                }
              : {})}
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
      {provider === "lolesports" && (
        <SportsSchedules
          guildId={props.guildId}
          refresh={scheduleRefresh}
          onMessage={setMessage}
        />
      )}
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
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.startsAt));
}
