import type { DiscordGuildId } from "@scout-for-lol/data";
import { Loaded } from "@shepherdjerred/loaded";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  FriendlyPageLoading,
  FriendlyPageUnavailable,
} from "#src/components/friendly-page.tsx";
import {
  PlayersView,
  type SearchState,
} from "#src/components/players/players-view.tsx";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import { track } from "#src/lib/analytics.ts";
import {
  isSearchReady,
  playersMatching,
  type Roster,
} from "#src/lib/players/roster-page.ts";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";

/** Everyone in the viewer's servers: who is playing now, how they rank, how they did. */
export function ConsumerPlayers() {
  const trpc = useTRPC();
  const [guildIds, setGuildIds] = useState<DiscordGuildId[] | undefined>();
  const [find, setFind] = useState("");
  const query = useDebouncedValue(find.trim(), 250);
  const rosterQuery = useQuery(
    trpc.consumerPlayer.roster.queryOptions(undefined, {
      placeholderData: keepPreviousData,
    }),
  );
  const searchReady = isSearchReady(query) && isSearchReady(find);
  const searchQuery = useQuery(
    trpc.consumerPlayer.search.queryOptions(
      { query },
      { enabled: searchReady, placeholderData: keepPreviousData },
    ),
  );
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!rosterQuery.isSuccess && !rosterQuery.isError)) {
      return;
    }
    opened.current = true;
    track("players_roster_opened", {
      outcome: rosterQuery.isSuccess ? "succeeded" : "failed",
    });
  }, [rosterQuery.isError, rosterQuery.isSuccess]);

  const search = searchState({
    ready: searchReady,
    // The typed text is ahead of the settled one while the debounce runs.
    settled: query === find.trim(),
    query: searchQuery,
    roster: rosterQuery.data,
  });
  const trackedSearch = useRef<string | null>(null);
  useEffect(() => {
    if (search.kind === "idle" || search.kind === "loading") {
      if (search.kind === "idle") trackedSearch.current = null;
      return;
    }
    if (trackedSearch.current === query) return;
    trackedSearch.current = query;
    track("player_search_performed", {
      outcome:
        search.kind === "failed"
          ? "failed"
          : search.players.length === 0
            ? "empty"
            : "results",
      surface: "players_typeahead",
    });
  }, [query, search]);

  // The roster is scoped to the viewer's currently enabled shared servers, so a
  // failed refetch is the access recheck: `strict` drops the retained page
  // rather than showing a list that outlived the permission behind it.
  const roster = Loaded.strict(Loaded.fromQuery(rosterQuery, ["roster"]));
  if (roster.status === "loading") return <FriendlyPageLoading />;
  if (roster.status === "error") {
    return (
      <FriendlyPageUnavailable
        id="players-unavailable"
        title="Players unavailable"
        lead="Players could not be loaded."
        onRetry={() => void rosterQuery.refetch()}
      />
    );
  }
  return (
    <PlayersView
      roster={roster.data}
      guildIds={guildIds}
      onGuildIds={(next) => {
        setGuildIds(next);
        track("players_filter_changed", { kind: "servers" });
      }}
      find={find}
      onFind={setFind}
      search={search}
      nowMs={Date.now()}
    />
  );
}

function searchState(input: {
  ready: boolean;
  settled: boolean;
  query: {
    data: RouterOutputs["consumerPlayer"]["search"] | undefined;
    isError: boolean;
    isFetching: boolean;
    isPlaceholderData: boolean;
    refetch: () => unknown;
  };
  roster: Roster | undefined;
}): SearchState {
  if (!input.ready) return { kind: "idle" };
  const { query } = input;
  if (!input.settled || query.isPlaceholderData || query.isFetching) {
    return { kind: "loading" };
  }
  if (query.isError) {
    return { kind: "failed", onRetry: () => void query.refetch() };
  }
  if (input.roster === undefined) return { kind: "loading" };
  const ranked = query.data?.results.map((result) => result.playerId) ?? [];
  return { kind: "found", players: playersMatching(input.roster, ranked) };
}
