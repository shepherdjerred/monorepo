import type { ComponentProps } from "react";
import type { Loaded } from "@shepherdjerred/loaded";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Section } from "#src/components/player/player-detail-sections.tsx";
import { PlayerProfileFilterBar } from "#src/components/player/player-profile-filter-bar.tsx";
import { ChampionPoolTable } from "#src/components/player/champion-pool-table.tsx";
import { PlayerSummaryCards } from "#src/components/player/player-profile-sections.tsx";
import {
  RecordedMatchHistory,
  shouldShowPlayerPerformanceBlank,
  type HistoryCursor,
} from "#src/components/player/recorded-match-history.tsx";
import {
  filterKey,
  type PlayerProfileFilters,
} from "#src/lib/player/player-profile-filters.ts";

export function CombinedPerformance(props: {
  filters: PlayerProfileFilters;
  onFiltersChange: (
    filters: PlayerProfileFilters,
    kind: "games" | "queues",
  ) => void;
  championPool: ComponentProps<typeof ChampionPoolTable>["rows"];
  minGamesForRate: number;
  ranks: ComponentProps<typeof PlayerSummaryCards>["ranks"];
  recentForm: ComponentProps<typeof PlayerSummaryCards>["recentForm"];
  history: Loaded<unknown>;
  historyFetching: boolean;
  historyRefetching: boolean;
  entries: ComponentProps<typeof RecordedMatchHistory>["entries"];
  nextCursor: HistoryCursor | null;
  historyPage: number;
  championSearch?: string;
  onChampionSearchChange?: (value: string) => void;
  playerId: number;
  profileSearch: string;
  onRetryHistory: () => void;
  onPreviousHistory: () => void;
  onNextHistory: (cursor: HistoryCursor) => void;
}) {
  const historyPending =
    props.history.status === "loading" || props.historyRefetching;
  const historyError = props.history.status === "error";
  const performanceBlank = shouldShowPlayerPerformanceBlank({
    championCount: props.championPool.length,
    matchCount: props.entries.length,
    historyPage: props.historyPage,
    historyPending,
    historyError,
  });
  if (historyPending && props.championPool.length === 0) {
    return <p className="text-sm text-scout-subtle">Loading games…</p>;
  }
  return (
    <>
      <h2 className="text-xl font-semibold">Combined performance</h2>
      <PlayerProfileFilterBar
        filters={props.filters}
        onChange={props.onFiltersChange}
      />
      {performanceBlank ? (
        <p className="text-sm text-scout-subtle">
          {props.filters.queues === undefined
            ? "Scout hasn't recorded any games for this player yet."
            : "No recorded games match these filters. Try All games to see every recorded queue."}
        </p>
      ) : (
        <>
          <PlayerSummaryCards
            ranks={props.ranks}
            recentForm={props.recentForm}
          />
          {props.championPool.length > 0 && (
            <Section title="Champion performance">
              <ChampionPoolTable
                key={filterKey(props.filters)}
                rows={props.championPool}
                minGamesForRate={props.minGamesForRate}
                profileSearch={props.profileSearch}
              />
            </Section>
          )}
          {props.onChampionSearchChange !== undefined && (
            <label
              className="block space-y-1 text-sm"
              htmlFor="champion-history-search"
            >
              <span>Search recorded matches by champion</span>
              <Input
                id="champion-history-search"
                value={props.championSearch ?? ""}
                onChange={(event) =>
                  props.onChampionSearchChange?.(event.target.value)
                }
                placeholder="Champion name"
                maxLength={40}
              />
              <span className="block text-xs text-scout-subtle">
                The game limit applies after champion search.
              </span>
            </label>
          )}
          <RecordedMatchHistory
            history={props.history}
            fetching={props.historyFetching}
            refetching={props.historyRefetching}
            entries={props.entries}
            nextCursor={props.nextCursor}
            page={props.historyPage}
            playerId={props.playerId}
            profileSearch={props.profileSearch}
            onRetry={props.onRetryHistory}
            onPrevious={props.onPreviousHistory}
            onNext={props.onNextHistory}
          />
        </>
      )}
    </>
  );
}
