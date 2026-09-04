import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ChampionComparisonSortSchema,
  type ChampionComparisonSort,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ChampionIcon } from "#src/components/champion-icon.tsx";
import {
  ChampionComparisonTable,
  type ChampionComparisonRow,
} from "#src/components/champion-comparison-table.tsx";
import { PageSectionHeading } from "#src/components/page-section-heading.tsx";
import { PlayerProfileFilterBar } from "#src/components/player-profile-filter-bar.tsx";
import { track } from "#src/lib/analytics.ts";
import {
  playerProfileSearch,
  type PlayerProfileFilters,
} from "#src/lib/player-profile-filters.ts";
import { useConsumerChampionParams } from "#src/lib/route-params.ts";
import { useTRPC, type RouterOutputs } from "#src/lib/trpc.ts";
import { usePlayerProfileUrlState } from "#src/lib/use-player-profile-url-state.ts";

type Cursor = { offset: number };
type ComparisonOutput = RouterOutputs["consumerChampion"]["compare"];

function parseComparisonSort(value: string): ChampionComparisonSort {
  const parsed = ChampionComparisonSortSchema.safeParse(value);
  return parsed.success ? parsed.data : "win_rate";
}

function comparisonInput(options: {
  championId: number;
  filters: PlayerProfileFilters;
  sort: ChampionComparisonSort;
  guildIds: string[] | undefined;
}) {
  return {
    championId: options.championId,
    games: options.filters.games,
    sort: options.sort,
    ...(options.filters.queues === undefined
      ? {}
      : { queues: options.filters.queues }),
    ...(options.guildIds === undefined ? {} : { guildIds: options.guildIds }),
  };
}

function cohortInput<T extends ReturnType<typeof comparisonInput>>(
  common: T,
  cohort: "qualified" | "small_sample",
  cursor: Cursor | undefined,
) {
  return {
    ...common,
    cohort,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function useComparisonOpenTracking(isSuccess: boolean, isError: boolean): void {
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || (!isSuccess && !isError)) return;
    tracked.current = true;
    track("champion_comparison_opened", {
      outcome: isSuccess ? "succeeded" : "failed",
    });
  }, [isError, isSuccess]);
}

function comparisonPage(data: ComparisonOutput | undefined) {
  return {
    rows: data?.rows ?? [],
    nextCursor: data?.nextCursor,
  };
}

function comparisonHeader(options: {
  qualified: ComparisonOutput | undefined;
  small: ComparisonOutput | undefined;
  guildIds: string[] | undefined;
}) {
  const data = options.qualified ?? options.small;
  const availableGuilds = data?.availableGuilds ?? [];
  return {
    champion: data?.champion,
    availableGuilds,
    selectedGuilds:
      options.guildIds ?? availableGuilds.map((guild) => guild.guildId),
  };
}

export function ConsumerChampion() {
  const { championId } = useConsumerChampionParams();
  const { filters, setFilters } = usePlayerProfileUrlState();
  const trpc = useTRPC();
  const [sort, setSort] = useState<ChampionComparisonSort>("win_rate");
  const [guildIds, setGuildIds] = useState<string[] | undefined>();
  const [qualifiedCursors, setQualifiedCursors] = useState<
    (Cursor | undefined)[]
  >([undefined]);
  const [smallCursors, setSmallCursors] = useState<(Cursor | undefined)[]>([
    undefined,
  ]);
  const [qualifiedPage, setQualifiedPage] = useState(0);
  const [smallPage, setSmallPage] = useState(0);
  const commonInput = comparisonInput({
    championId,
    filters,
    sort,
    guildIds,
  });
  const qualified = useQuery(
    trpc.consumerChampion.compare.queryOptions(
      cohortInput(commonInput, "qualified", qualifiedCursors[qualifiedPage]),
      { placeholderData: keepPreviousData },
    ),
  );
  const small = useQuery(
    trpc.consumerChampion.compare.queryOptions(
      cohortInput(commonInput, "small_sample", smallCursors[smallPage]),
      { placeholderData: keepPreviousData },
    ),
  );
  useComparisonOpenTracking(qualified.isSuccess, qualified.isError);

  function resetPagination(): void {
    setQualifiedCursors([undefined]);
    setSmallCursors([undefined]);
    setQualifiedPage(0);
    setSmallPage(0);
  }

  if (qualified.isError || small.isError) {
    return (
      <PageShell>
        <Card>
          <CardHeader>
            <CardTitle>Champion comparison unavailable</CardTitle>
            <CardDescription>
              Scout could not verify this champion against your currently
              enabled shared servers.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={() => void qualified.refetch()}>Retry</Button>
            <Button asChild variant="outline">
              <Link to="/players">Players</Link>
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const { champion, availableGuilds, selectedGuilds } = comparisonHeader({
    qualified: qualified.data,
    small: small.data,
    guildIds,
  });
  const qualifiedResult = comparisonPage(qualified.data);
  const smallResult = comparisonPage(small.data);
  const profileSearch = playerProfileSearch(filters);

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {champion === undefined ? null : (
            <ChampionIcon
              championName={champion.name}
              size="md"
              className="h-14 w-14"
            />
          )}
          <div>
            <p className="text-sm font-medium text-primary">
              Champion comparison
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {champion?.name ?? "Loading champion…"}
            </h1>
            <p className="text-sm text-scout-subtle">
              Each guild registration stays a distinct leaderboard entry.
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/players">Player hub</Link>
        </Button>
      </div>

      <PlayerProfileFilterBar
        filters={filters}
        onChange={(nextFilters, kind) => {
          resetPagination();
          setFilters(nextFilters);
          track("player_profile_filter_changed", {
            kind,
            action: "champion_comparison",
          });
        }}
      />

      <div className="flex flex-wrap items-end gap-6 rounded-lg border bg-card p-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Guilds</legend>
          <div className="flex flex-wrap gap-3">
            {availableGuilds.map((guild) => (
              <label
                key={guild.guildId}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="guild"
                  value={guild.guildId}
                  checked={selectedGuilds.includes(guild.guildId)}
                  onChange={(event) => {
                    const next = event.currentTarget.checked
                      ? [...selectedGuilds, guild.guildId]
                      : selectedGuilds.filter((id) => id !== guild.guildId);
                    if (next.length === 0) return;
                    setGuildIds(next);
                    resetPagination();
                  }}
                />
                {guild.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="space-y-1 text-sm font-medium">
          <span className="block">Sort by</span>
          <select
            name="sort"
            value={sort}
            className="h-9 rounded-md border border-input bg-background px-3"
            onChange={(event) => {
              setSort(parseComparisonSort(event.currentTarget.value));
              resetPagination();
            }}
          >
            <option value="win_rate">Win rate</option>
            <option value="games">Games</option>
            <option value="kda">KDA</option>
            <option value="cs_per_minute">CS/min</option>
            <option value="damage_per_minute">Damage/min</option>
            <option value="gold_per_minute">Gold/min</option>
            <option value="vision_per_minute">Vision/min</option>
            <option value="alias">Alias</option>
          </select>
        </label>
      </div>

      <ComparisonSection
        title="Leaderboard"
        description="Players with at least 10 matching games."
        rows={qualifiedResult.rows}
        profileSearch={profileSearch}
        page={qualifiedPage}
        nextCursor={qualifiedResult.nextCursor}
        pending={qualified.isPending || qualified.isFetching}
        empty="No player has ten matching games on this champion yet."
        onPrevious={() => {
          setQualifiedPage((page) => page - 1);
        }}
        onNext={(cursor) => {
          setQualifiedCursors((cursors) => [
            ...cursors.slice(0, qualifiedPage + 1),
            cursor,
          ]);
          setQualifiedPage((page) => page + 1);
        }}
      />
      <ComparisonSection
        title="Smaller samples"
        description="Useful context, kept separate from the ranked leaderboard."
        rows={smallResult.rows}
        profileSearch={profileSearch}
        page={smallPage}
        nextCursor={smallResult.nextCursor}
        pending={small.isPending || small.isFetching}
        empty="No smaller samples match these filters."
        onPrevious={() => {
          setSmallPage((page) => page - 1);
        }}
        onNext={(cursor) => {
          setSmallCursors((cursors) => [
            ...cursors.slice(0, smallPage + 1),
            cursor,
          ]);
          setSmallPage((page) => page + 1);
        }}
      />
    </PageShell>
  );
}

function ComparisonSection(props: {
  title: string;
  description: string;
  rows: ChampionComparisonRow[];
  profileSearch: string;
  page: number;
  nextCursor: Cursor | null | undefined;
  pending: boolean;
  empty: string;
  onPrevious: () => void;
  onNext: (cursor: Cursor) => void;
}) {
  return (
    <section className="space-y-3">
      <PageSectionHeading title={props.title} description={props.description} />
      <ChampionComparisonTable
        rows={props.rows}
        profileSearch={props.profileSearch}
        page={props.page}
        hasNextPage={
          props.nextCursor !== null && props.nextCursor !== undefined
        }
        pending={props.pending}
        empty={props.empty}
        onPrevious={props.onPrevious}
        onNext={() => {
          if (props.nextCursor !== null && props.nextCursor !== undefined)
            props.onNext(props.nextCursor);
        }}
      />
    </section>
  );
}

function PageShell(props: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:py-12">
      {props.children}
    </div>
  );
}
