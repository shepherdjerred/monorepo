import { useId, useState } from "react";
import { SportsResultsSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ItemSection } from "@shepherdjerred/streambot/web/client/media/item-section.tsx";
import {
  MediaRow,
  SkeletonRows,
} from "@shepherdjerred/streambot/web/client/media/media-row.tsx";
import { FailureNotice } from "@shepherdjerred/streambot/web/client/failure-notice.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import {
  useBrowseGuild,
  useParamState,
} from "@shepherdjerred/streambot/web/client/library/browse-state.ts";
import { DisabledPage } from "@shepherdjerred/streambot/web/client/library/disabled-page.tsx";
import {
  FilterBar,
  SelectFilter,
  TextFilter,
} from "@shepherdjerred/streambot/web/client/library/filters.tsx";
import { PageHeading } from "@shepherdjerred/streambot/web/client/library/page-heading.tsx";
import {
  gameItem,
  groupGames,
  LEAGUES,
  leagueLabel,
  providerOptions,
  readLiveFilters,
  sportsUrl,
  type Game,
} from "./games.ts";
import { ScheduleList } from "./schedule-list.tsx";
import { ScheduleRow } from "./schedule-row.tsx";
import "@shepherdjerred/streambot/web/client/styles/home.css";

const TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;

const RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "Next seven days" },
] as const;

/** Upcoming games: not playable yet, and a Schedule button where the server allows one. */
function UpcomingSection(props: {
  games: readonly Game[];
  guildId: string;
  onScheduled: () => void;
}) {
  const headingId = useId();
  return (
    <section
      className="section"
      aria-labelledby={headingId}
      data-row-scope="section"
    >
      <div className="section-head">
        <h2 id={headingId} className="section-heading">
          Upcoming
        </h2>
      </div>
      {props.games.length === 0 ? (
        <p className="empty-note">No upcoming games match these filters.</p>
      ) : (
        <ul className="rows">
          {props.games.map((game) =>
            game.canSchedule === true ? (
              <ScheduleRow
                key={game.id}
                item={gameItem(game)}
                gameId={game.id}
                guildId={props.guildId}
                onScheduled={props.onScheduled}
              />
            ) : (
              <MediaRow key={game.id} item={gameItem(game)} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

export function LivePage() {
  const remote = useRemote();
  const guildId = useBrowseGuild();
  const { params, update } = useParamState();
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const capabilities = remote.room?.capabilities;
  const lolEsports = capabilities?.lolEsports === true;
  const filters = readLiveFilters(params, lolEsports);
  const load = useLoad(
    guildId !== "" && capabilities?.sports === true
      ? sportsUrl(guildId, filters, TIME_ZONE)
      : null,
    SportsResultsSchema,
  );
  if (capabilities !== undefined && !capabilities.sports)
    return (
      <DisabledPage
        title="Live games"
        reason="Live sports are not enabled in this server."
      />
    );
  const lol = filters.provider === "lolesports";
  const groups =
    load.state.status === "done" ? groupGames(load.state.data) : null;
  return (
    <div className="page">
      <PageHeading
        title="Live games"
        aside={
          <button type="button" className="btn btn-small" onClick={load.retry}>
            Refresh
          </button>
        }
      />
      <FilterBar label="Live game filters">
        <TextFilter
          label="Find a game"
          placeholder="A team, league, or matchup"
          value={filters.query}
          onApply={(value) => {
            update({ q: value });
          }}
        />
        <SelectFilter
          label="Provider"
          value={filters.provider}
          options={providerOptions(lolEsports)}
          onChange={(value) => {
            update({ provider: value, league: "", range: "" });
          }}
        />
        {lol && (
          <>
            <SelectFilter
              label="Competition"
              value={filters.league}
              options={[
                { value: "", label: "All major competitions" },
                ...LEAGUES.map((value) => ({
                  value,
                  label: leagueLabel(value),
                })),
              ]}
              onChange={(value) => {
                update({ league: value });
              }}
            />
            <SelectFilter
              label="Window"
              value={filters.range}
              options={RANGES}
              onChange={(value) => {
                update({ range: value });
              }}
            />
          </>
        )}
      </FilterBar>
      <p className="section-note">
        Watch starts a live game as a stream in your voice channel. Upcoming
        games can be watched once they start.
      </p>
      {load.state.status === "loading" && (
        <ul className="rows" aria-busy="true">
          <SkeletonRows count={3} />
        </ul>
      )}
      {load.state.status === "failed" && (
        <p className="status">
          <FailureNotice failure={load.state.failure} onRetry={load.retry} />
        </p>
      )}
      {groups !== null && (
        <>
          <ItemSection
            title="Live now"
            load={{ status: "done", data: groups.live }}
            onRetry={load.retry}
            items={(games) => games.map((game) => gameItem(game))}
            empty="No games are live right now."
          />
          <UpcomingSection
            games={groups.upcoming}
            guildId={guildId}
            onScheduled={() => {
              setScheduleVersion((value) => value + 1);
            }}
          />
          {groups.unconfirmed.length > 0 && (
            <ItemSection
              title="Start time unconfirmed"
              load={{ status: "done", data: groups.unconfirmed }}
              onRetry={load.retry}
              items={(games) => games.map((game) => gameItem(game))}
              empty=""
            />
          )}
        </>
      )}
      {lol && guildId !== "" && (
        <ScheduleList key={scheduleVersion} guildId={guildId} />
      )}
    </div>
  );
}
