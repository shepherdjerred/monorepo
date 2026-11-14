import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import {
  CalendarPageSchema,
  type CalendarEvent,
} from "#shared/household/calendar.ts";
import { readApi } from "#client/api.ts";
import {
  EmptyState,
  ErrorNotice,
  humanize,
  Loading,
  MediaLink,
  PageTitle,
  Status,
} from "#client/components.tsx";
import { firstListCursor } from "#client/household/list-cursor.ts";
import {
  calendarDays,
  dateOnlyLabel,
  localToday,
  shiftCalendarDays,
} from "./dates.ts";
import "./style.css";

export function CalendarPage({ user }: { user: MediaUser }) {
  const [anchor, setAnchor] = useState(localToday);
  const [view, setView] = useState<"month" | "week" | "agenda">("month");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const days = calendarDays(anchor, view);
  const from = days[0] ?? anchor;
  const to = days.at(-1) ?? anchor;
  const calendar = useInfiniteQuery({
    queryKey: ["calendar", from, to, kind, status],
    initialPageParam: firstListCursor(),
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ from, to, kind, status });
      if (pageParam !== null) query.set("cursor", pageParam);
      return readApi(`/calendar?${query.toString()}`, CalendarPageSchema);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const events = calendar.data?.pages.flatMap((page) => page.events) ?? [];
  const dated = events.filter((event) => event.date !== null);
  const unknown = events.filter((event) => event.date === null);
  function move(direction: number) {
    if (view === "month") {
      const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchor(date.toISOString().slice(0, 10));
    } else
      setAnchor(
        shiftCalendarDays(anchor, direction * (view === "week" ? 7 : 31)),
      );
  }
  return (
    <>
      <PageTitle
        eyebrow={
          user.role === "owner"
            ? "Your household collection"
            : "Your followed titles"
        }
        title="Calendar"
      >
        <p>
          TV air dates and US cinema, digital, and physical movie releases.
          Dates may change; availability shows what is ready in your library.
        </p>
      </PageTitle>
      <section
        className="panel calendar-controls"
        aria-label="Calendar controls"
      >
        <div className="calendar-toolbar">
          <button
            className="button subtle"
            onClick={() => {
              move(-1);
            }}
            aria-label="Previous period"
          >
            ←
          </button>
          <label>
            Starting date{" "}
            <input
              type="date"
              value={anchor}
              required
              onChange={(event) => {
                if (event.target.value !== "") setAnchor(event.target.value);
              }}
            />
          </label>
          <button
            className="button subtle"
            onClick={() => {
              move(1);
            }}
            aria-label="Next period"
          >
            →
          </button>
          <button
            className="button subtle"
            onClick={() => {
              setAnchor(localToday());
            }}
          >
            Today
          </button>
        </div>
        <div
          className="calendar-toolbar"
          role="group"
          aria-label="Calendar view"
        >
          {(["month", "week", "agenda"] as const).map((option) => (
            <button
              key={option}
              className="button subtle"
              aria-pressed={view === option}
              onClick={() => {
                setView(option);
              }}
            >
              {humanize(option)}
            </button>
          ))}
        </div>
        <div className="calendar-toolbar">
          <label>
            Release{" "}
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
              }}
            >
              <option value="all">All releases</option>
              <option value="episode">TV episodes</option>
              <option value="theatrical">Cinema</option>
              <option value="digital">Digital</option>
              <option value="physical">Physical</option>
            </select>
          </label>
          <label>
            Library status{" "}
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
              }}
            >
              <option value="all">All statuses</option>
              <option value="available">Available</option>
              <option value="missing">Not available</option>
            </select>
          </label>
        </div>
      </section>
      {calendar.isPending && <Loading />}
      {calendar.error !== null && <ErrorNotice error={calendar.error} />}
      {!calendar.isPending && events.length === 0 && (
        <EmptyState title="No releases in this view">
          Follow a show or request a movie to see its dates here.
        </EmptyState>
      )}
      {view === "agenda" ? (
        <section aria-label="Release agenda" className="calendar-agenda">
          {dated.map((event) => (
            <article className="panel" key={event.id}>
              <h2>
                {event.date === null
                  ? "Date to be announced"
                  : dateOnlyLabel(event.date)}
              </h2>
              <CalendarEntry event={event} />
            </article>
          ))}
        </section>
      ) : (
        <div
          className="calendar-table-wrap"
          role="region"
          aria-label={`${view} calendar`}
          tabIndex={0}
        >
          <table className="release-calendar">
            <caption>
              {dateOnlyLabel(from)} – {dateOnlyLabel(to)}
            </caption>
            <thead>
              <tr>
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((day) => (
                  <th key={day} scope="col">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: days.length / 7 }, (_, week) => (
                <tr key={week}>
                  {days.slice(week * 7, week * 7 + 7).map((day) => (
                    <td
                      key={day}
                      className={day === localToday() ? "calendar-today" : ""}
                    >
                      <time dateTime={day}>{dateOnlyLabel(day)}</time>
                      {dated
                        .filter((event) => event.date === day)
                        .map((event) => (
                          <CalendarEntry key={event.id} event={event} />
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unknown.length > 0 && (
        <section className="panel">
          <h2>Dates to be announced</h2>
          <p className="muted">
            These releases have no confirmed date and are outside the dated
            grid.
          </p>
          <div className="calendar-unknown">
            {unknown.map((event) => (
              <CalendarEntry key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
      {calendar.hasNextPage && (
        <button
          className="button"
          disabled={calendar.isFetchingNextPage}
          onClick={() => {
            void calendar.fetchNextPage();
          }}
        >
          {calendar.isFetchingNextPage ? "Loading…" : "Load more releases"}
        </button>
      )}
    </>
  );
}

function CalendarEntry({ event }: { event: CalendarEvent }) {
  return (
    <article className="calendar-entry">
      <MediaLink id={event.mediaId} title={event.seriesTitle ?? event.title} />
      {event.seriesTitle !== null && (
        <p>
          {event.title}
          {event.seasonNumber === null || event.episodeNumber === null
            ? ""
            : ` · S${String(event.seasonNumber)} E${String(event.episodeNumber)}`}
        </p>
      )}
      <p>
        {event.kind === "episode"
          ? "TV episode"
          : `${humanize(event.kind)} · US`}
      </p>
      <Status value={event.availability} />
    </article>
  );
}
