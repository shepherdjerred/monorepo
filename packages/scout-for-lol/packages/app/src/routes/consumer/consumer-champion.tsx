import type { DiscordGuildId, Lane } from "@scout-for-lol/data";
import { PageState } from "@scout-for-lol/design-system/domain/profile/page-states";
import { Loaded } from "@shepherdjerred/loaded";
import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { MatchupsPanel } from "#src/components/champions/champion-matchups.tsx";
import { MasteryPanel } from "#src/components/champions/champion-side.tsx";
import { ChampionView } from "#src/components/champions/champion-view.tsx";
import {
  ChampionsLoading,
  ChampionsUnavailable,
} from "#src/components/champions/champions-shell.tsx";
import { ServerChips } from "#src/components/champions/server-chips.tsx";
import { track } from "#src/lib/analytics.ts";
import {
  activeLane,
  championScopeInput,
} from "#src/lib/champions/champion-pages.ts";
import { usePlayerProfileUrlState } from "#src/lib/player/use-player-profile-url-state.ts";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";
import { useConsumerChampionParams } from "#src/lib/routes/route-params.ts";

/** One champion in the viewer's servers: who is best on it, and the viewer's matchups. */
export function ConsumerChampion() {
  const { championId } = useConsumerChampionParams();
  const { filters } = usePlayerProfileUrlState();
  const trpc = useTRPC();
  const [guildIds, setGuildIds] = useState<DiscordGuildId[] | undefined>();
  const [chosenLane, setChosenLane] = useState<Lane | undefined>();
  const scope = championScopeInput(filters, guildIds);
  const keep = { placeholderData: keepPreviousData };
  const qualified = useQuery(
    trpc.consumerChampion.compare.queryOptions(
      { championId, ...scope, cohort: "qualified", sort: "win_rate" },
      keep,
    ),
  );
  const small = useQuery(
    trpc.consumerChampion.compare.queryOptions(
      { championId, ...scope, cohort: "small_sample", sort: "games" },
      keep,
    ),
  );
  const index = useQuery(trpc.consumerChampion.index.queryOptions(scope, keep));
  const lanes =
    index.data?.champions.find((entry) => entry.championId === championId)
      ?.lanes ?? [];
  const lane = activeLane(lanes, chosenLane);
  const matchups = useQuery(
    trpc.consumerChampion.matchups.queryOptions(
      lane === undefined ? skipToken : { championId, lane, ...scope },
      keep,
    ),
  );
  const mastery = useQuery(
    trpc.consumerChampion.masteryLeaderboard.queryOptions(
      guildIds === undefined ? { championId } : { championId, guildIds },
      keep,
    ),
  );
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!qualified.isSuccess && !qualified.isError)) return;
    opened.current = true;
    track("champion_comparison_opened", {
      outcome: qualified.isSuccess ? "succeeded" : "failed",
    });
  }, [qualified.isError, qualified.isSuccess]);

  // Every read here is scoped to the viewer's currently enabled shared
  // servers, so a failed refetch is the access recheck. `strict` drops the
  // retained page instead of showing one that outlived the permission behind it.
  const page = Loaded.all({
    qualified: Loaded.strict(Loaded.fromQuery(qualified, ["qualified"])),
    small: Loaded.strict(Loaded.fromQuery(small, ["small"])),
    index: Loaded.strict(Loaded.fromQuery(index, ["index"])),
  });
  if (page.status === "loading") {
    return <ChampionsLoading />;
  }
  if (page.status === "error") {
    return (
      <ChampionsUnavailable
        title="Champion unavailable"
        lead="This champion could not be loaded."
        onRetry={() => {
          void qualified.refetch();
          void small.refetch();
          void index.refetch();
        }}
      />
    );
  }
  const matchupsResult = Loaded.strict(
    Loaded.fromQuery(matchups, ["matchups"]),
  );
  const masteryResult = Loaded.strict(Loaded.fromQuery(mastery, ["mastery"]));
  // The page appears once, whole: matchups and mastery would otherwise pop in
  // below it and push the page around after the reader has started on it.
  if (
    masteryResult.status === "loading" ||
    (lane !== undefined && matchupsResult.status === "loading")
  ) {
    return <ChampionsLoading />;
  }
  return (
    <ChampionView
      championId={championId}
      name={page.data.qualified.champion.name}
      qualifyingGames={page.data.qualified.qualifyingGames}
      qualified={page.data.qualified.rows}
      small={page.data.small.rows}
      truncated={page.data.qualified.nextCursor !== null}
      servers={
        <ServerChips
          servers={page.data.qualified.availableGuilds}
          selected={guildIds}
          onChange={(next) => {
            setGuildIds(next);
            track("champions_filter_changed", { kind: "servers" });
          }}
        />
      }
      matchups={
        lane === undefined
          ? null
          : matchupsSection({
              result: matchupsResult,
              lanes: lanes.map((entry) => entry.lane),
              lane,
              onLane: (next) => {
                setChosenLane(next);
                track("champions_filter_changed", { kind: "lane" });
              },
              onRetry: () => void matchups.refetch(),
            })
      }
      mastery={
        masteryResult.status === "done" &&
        masteryResult.data.rows.length > 0 ? (
          <MasteryPanel rows={masteryResult.data.rows} />
        ) : null
      }
    />
  );
}

function matchupsSection(options: {
  result: Loaded<RouterOutputs["consumerChampion"]["matchups"]>;
  lanes: Lane[];
  lane: Lane;
  onLane: (lane: Lane) => void;
  onRetry: () => void;
}) {
  const { result } = options;
  if (result.status === "loading") return null;
  if (result.status === "error") {
    return (
      <PageState
        kind="unavailable"
        id="matchups-unavailable"
        title="Your matchups"
        lead="Matchups could not be loaded."
        actions={
          <button
            type="button"
            className={chipVariants()}
            onClick={options.onRetry}
          >
            Retry
          </button>
        }
      />
    );
  }
  return (
    <MatchupsPanel
      matchups={result.data.matchups}
      lanes={options.lanes}
      lane={options.lane}
      onLane={options.onLane}
    />
  );
}
