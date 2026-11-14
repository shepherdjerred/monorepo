import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import {
  NowPlayingSchema,
  PlaybackHistorySchema,
  PlaybackPeopleSchema,
  PlaybackStatisticsSchema,
  type PlaybackSessionViewSchema,
} from "#shared/household/playback.ts";
import { readApi } from "#client/api.ts";
import {
  dateLabel,
  ErrorNotice,
  humanize,
  Loading,
  PageTitle,
} from "#client/components.tsx";
import "./playback.css";

function watchTime(ms: number) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(ms / 3_600_000)} hr`;
}

export function PlaybackHistoryPage({ user }: { user: MediaUser }) {
  const [params, setParams] = useSearchParams();
  const cursor = params.get("cursor");
  const setCursor = (value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete("cursor");
    else next.set("cursor", value);
    setParams(next);
  };
  const query = new URLSearchParams();
  for (const name of ["search", "userId", "from", "to"]) {
    const value = params.get(name);
    if (value !== null && value !== "") query.set(name, value);
  }
  const filterKey = query.toString();
  const historyQuery = new URLSearchParams(query);
  if (cursor !== null) historyQuery.set("cursor", cursor);
  const history = useQuery({
    queryKey: ["playback", "history", filterKey, cursor],
    queryFn: async () =>
      readApi(
        `/playback/history?${historyQuery.toString()}`,
        PlaybackHistorySchema,
      ),
  });
  const stats = useQuery({
    queryKey: ["playback", "statistics", filterKey],
    queryFn: async () =>
      readApi(
        `/playback/statistics?${query.toString()}`,
        PlaybackStatisticsSchema,
      ),
  });
  const people = useQuery({
    queryKey: ["playback", "people"],
    queryFn: async () => readApi("/playback/people", PlaybackPeopleSchema),
  });
  return (
    <>
      <PageTitle
        eyebrow={user.role === "owner" ? "Household activity" : "Your activity"}
        title="Watch history"
      >
        <p>
          What is playing, what you have watched, and the titles you return to.
        </p>
      </PageTitle>
      <NowPlaying />
      <form
        key={filterKey}
        className="panel playback-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const next = new URLSearchParams();
          for (const name of ["search", "userId"]) {
            const value = form.get(name);
            if (typeof value === "string" && value !== "")
              next.set(name, value);
          }
          for (const name of ["from", "to"]) {
            const value = form.get(name);
            if (typeof value === "string" && value !== "")
              next.set(name, new Date(`${value}T00:00:00`).toISOString());
          }
          setParams(next);
        }}
      >
        <label htmlFor="playback-search">
          Title
          <input
            id="playback-search"
            name="search"
            type="search"
            maxLength={200}
            defaultValue={params.get("search") ?? ""}
          />
        </label>
        {user.role === "owner" && (
          <label htmlFor="playback-person">
            Person
            <select
              id="playback-person"
              name="userId"
              defaultValue={params.get("userId") ?? ""}
            >
              <option value="">Everyone</option>
              {people.data?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor="playback-from">
          From
          <input
            id="playback-from"
            name="from"
            type="date"
            defaultValue={localDate(params.get("from"))}
          />
        </label>
        <label htmlFor="playback-to">
          Before
          <input
            id="playback-to"
            name="to"
            type="date"
            defaultValue={localDate(params.get("to"))}
          />
        </label>
        <button className="button" type="submit">
          Apply filters
        </button>
        <button
          className="button subtle"
          type="button"
          onClick={() => {
            setParams({});
          }}
        >
          Clear filters
        </button>
      </form>
      {stats.error === null ? (
        stats.isPending ? (
          <Loading />
        ) : (
          <Statistics data={stats.data} owner={user.role === "owner"} />
        )
      ) : (
        <ErrorNotice error={stats.error} />
      )}
      <section className="panel">
        <h2>Viewing history</h2>
        {history.error === null ? (
          history.isPending ? (
            <Loading />
          ) : (
            <>
              {history.data.items.length === 0 ? (
                <p>No viewing history matches these filters.</p>
              ) : (
                <HistoryTable items={history.data.items} />
              )}
              <div className="playback-pagination">
                <button
                  className="button subtle"
                  disabled={cursor === null}
                  onClick={() => {
                    setCursor(null);
                  }}
                >
                  Newest
                </button>
                <button
                  className="button subtle"
                  disabled={history.data.nextCursor === null}
                  onClick={() => {
                    setCursor(history.data.nextCursor);
                  }}
                >
                  Older sessions
                </button>
              </div>
            </>
          )
        ) : (
          <ErrorNotice error={history.error} />
        )}
      </section>
    </>
  );
}

function NowPlaying() {
  const playing = useQuery({
    queryKey: ["playback", "now"],
    queryFn: async () => readApi("/playback/now-playing", NowPlayingSchema),
    refetchInterval: 60_000,
  });
  if (playing.error !== null) return <ErrorNotice error={playing.error} />;
  if (playing.isPending) return <Loading />;
  const data = playing.data;
  return (
    <section className="panel">
      <h2>Now playing</h2>
      {data.stale ? (
        <p>
          Playback observation is unavailable. Last checked:{" "}
          {dateLabel(data.observedAt)}.
        </p>
      ) : data.items.length === 0 ? (
        <p>Nothing is playing right now.</p>
      ) : (
        <ul className="playback-now">
          {data.items.map((item) => (
            <li key={item.id}>
              <strong>
                {item.seriesTitle === null
                  ? item.title
                  : `${item.seriesTitle} · ${item.title}`}
              </strong>
              <p>
                {item.userName ?? "Unmapped account"} · {item.platform} ·{" "}
                {humanize(item.state)} · {humanize(item.decision)}
              </p>
              <progress
                aria-label={`${item.title} playback position`}
                value={item.progressMs}
                max={Math.max(1, item.durationMs)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Statistics({
  data,
  owner,
}: {
  data: z.infer<typeof PlaybackStatisticsSchema>;
  owner: boolean;
}) {
  return (
    <section className="panel">
      <h2>Statistics</h2>
      <dl className="playback-summary">
        <div>
          <dt>Plays</dt>
          <dd>{data.plays.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Watch time</dt>
          <dd>{watchTime(data.watchedMs)}</dd>
        </div>
        <div>
          <dt>Completed plays</dt>
          <dd>{data.completedPlays.toLocaleString()}</dd>
        </div>
      </dl>
      <p className="muted">
        Plays under 2 minutes are excluded. Completion is the historical 85%
        reporting threshold, separate from Plex watched status.
      </p>
      <div className="playback-rankings">
        <Ranking title="Top titles" rows={data.topTitles} />
        {owner && <Ranking title="Top people" rows={data.topUsers} />}
        <Ranking title="Platforms" rows={data.topPlatforms} />
        <section>
          <h3>Playback</h3>
          <ul>
            {data.decisions.map((row) => (
              <li key={row.decision}>
                {humanize(row.decision)}: {row.plays.toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function Ranking({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; plays: number; watchedMs: number }[];
}) {
  return (
    <section>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>No plays yet.</p>
      ) : (
        <ol>
          {rows.map((row) => (
            <li key={row.label}>
              <strong>{row.label}</strong> · {row.plays} plays ·{" "}
              {watchTime(row.watchedMs)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
function localDate(value: string | null) {
  if (value === null) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : "";
}
function HistoryTable({
  items,
}: {
  items: z.infer<typeof PlaybackSessionViewSchema>[];
}) {
  return (
    <div
      className="playback-table"
      role="region"
      aria-label="Viewing history"
      tabIndex={0}
    >
      <table>
        <caption>Completed playback sessions</caption>
        <thead>
          <tr>
            {[
              "Title",
              "Person",
              "Started",
              "Watched",
              "Platform",
              "Playback",
              "Completion",
            ].map((label) => (
              <th scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <th scope="row">
                {item.seriesTitle === null
                  ? item.title
                  : `${item.seriesTitle} · ${item.title}`}
              </th>
              <td>{item.userName ?? "Unmapped account"}</td>
              <td>
                <time dateTime={item.startedAt}>
                  {dateLabel(item.startedAt)}
                </time>
              </td>
              <td>{watchTime(item.watchedMs)}</td>
              <td>{item.platform}</td>
              <td>{humanize(item.decision)}</td>
              <td>{item.completed ? "Completed" : "Partial"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
