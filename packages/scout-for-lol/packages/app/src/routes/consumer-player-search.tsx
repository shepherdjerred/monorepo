import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Combobox } from "@scout-for-lol/design-system/components/combobox";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ConsumerGuildAvatar } from "#src/components/consumer-guild-avatar.tsx";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import { track } from "#src/lib/analytics.ts";
import { formatRiotId } from "#src/lib/riot-id-format.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export const PROTECTED_CONSUMER_SEARCH_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always",
} as const;

export function isConsumerTypeaheadReady(query: string): boolean {
  return query.trim().length >= 2;
}

export function shouldHideConsumerSuggestions(input: {
  query: string;
  debouncedQuery: string;
  isPlaceholderData: boolean;
}): boolean {
  return (
    input.query.trim() !== input.debouncedQuery.trim() ||
    input.isPlaceholderData
  );
}

type SearchResult = {
  playerId: number;
  alias: string;
  guild: { name: string };
  accounts: {
    gameName: string | null;
    tagLine: string | null;
    region: string;
  }[];
};

export function ConsumerPlayerSearch() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const trimmedQuery = debouncedQuery.trim();
  const searchEnabled = isConsumerTypeaheadReady(debouncedQuery);
  const trackedQuery = useRef<string | null>(null);
  const statusQuery = useQuery(
    trpc.consumerPlayer.status.queryOptions(undefined, {
      retry: 2,
      staleTime: 0,
      refetchOnMount: "always",
    }),
  );
  const searchQuery = useQuery(
    trpc.consumerPlayer.search.queryOptions(
      { query: trimmedQuery },
      {
        enabled: searchEnabled && statusQuery.data?.state === "available",
        placeholderData: keepPreviousData,
        ...PROTECTED_CONSUMER_SEARCH_QUERY_OPTIONS,
      },
    ),
  );
  const suggestionsHidden = shouldHideConsumerSuggestions({
    query,
    debouncedQuery,
    isPlaceholderData: searchQuery.isPlaceholderData,
  });
  const suggestions = suggestionsHidden
    ? []
    : (searchQuery.data?.results ?? []);

  useEffect(() => {
    if (!searchEnabled) {
      trackedQuery.current = null;
      return;
    }
    if (suggestionsHidden || searchQuery.isFetching) return;
    if (!searchQuery.isSuccess && !searchQuery.isError) return;
    if (trackedQuery.current === trimmedQuery) return;
    trackedQuery.current = trimmedQuery;
    track("player_search_performed", {
      outcome: searchQuery.isError
        ? "failed"
        : suggestions.length === 0
          ? "empty"
          : "results",
      surface: "players_typeahead",
    });
  }, [
    searchEnabled,
    searchQuery.isError,
    searchQuery.isFetching,
    searchQuery.isSuccess,
    suggestions.length,
    suggestionsHidden,
    trimmedQuery,
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary">Player profiles</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Find a player Scout knows
        </h1>
        <p className="max-w-2xl text-scout-subtle">
          Search a Scout guild alias or Riot ID. Results only include configured
          players from enabled Discord servers you currently share with Scout.
        </p>
      </div>

      {statusQuery.isError ? (
        <RetryCard
          title="Scout couldn't verify your servers"
          description="Your Discord membership was not treated as a denial. Retry this temporary availability check."
          onRetry={() => {
            void statusQuery.refetch();
          }}
        />
      ) : statusQuery.data === undefined || statusQuery.isFetching ? (
        <p className="text-sm text-scout-subtle">Checking access…</p>
      ) : (
        renderStatusContent(
          statusQuery.data.state,
          <>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="consumer-player-search"
              >
                Guild alias or Riot ID
              </label>
              <Combobox<SearchResult>
                id="consumer-player-search"
                value={query}
                maxLength={100}
                placeholder="Start typing an alias or Name#Tag"
                items={suggestions}
                isLoading={
                  isConsumerTypeaheadReady(query) &&
                  (suggestionsHidden || searchQuery.isFetching)
                }
                getKey={(player) => player.playerId.toString()}
                onValueChange={setQuery}
                onSelect={(player) => {
                  void navigate("/players/" + player.playerId.toString(), {
                    state: { entrySurface: "search_results" },
                  });
                }}
                renderItem={(player) => <PlayerSuggestion player={player} />}
              />
              <p className="text-xs text-scout-subtle">
                Suggestions begin after two characters. Use the arrow keys and
                Enter to open a profile.
              </p>
            </div>

            <SearchFeedback
              query={query}
              ready={searchEnabled && !suggestionsHidden}
              pending={searchQuery.isFetching}
              error={searchQuery.isError}
              resultCount={suggestions.length}
              onRetry={() => {
                void searchQuery.refetch();
              }}
            />
          </>,
        )
      )}
    </div>
  );
}

function PlayerSuggestion({ player }: { player: SearchResult }) {
  return (
    <span className="flex w-full min-w-0 items-start gap-3 text-left">
      <ConsumerGuildAvatar name={player.guild.name} size="compact" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">{player.alias}</span>
          <span className="text-xs text-scout-subtle">{player.guild.name}</span>
        </span>
        <span className="mt-1 block truncate text-sm text-scout-subtle">
          {player.accounts
            .map((account) => formatRiotId(account, "Riot ID pending"))
            .join(" · ") || "No Riot ID observed yet"}
        </span>
      </span>
    </span>
  );
}

function renderStatusContent(
  state: "available" | "feature_disabled" | "no_shared_guild",
  availableContent: React.ReactNode,
): React.ReactNode {
  if (state === "available") return availableContent;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Player profiles aren&apos;t available here yet</CardTitle>
        <CardDescription>
          Profiles roll out server by server. Sign in with a Discord account
          that shares an enabled Scout server; administrator permission is not
          required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/">Back to Scout</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function RetryCard(props: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={props.onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function SearchFeedback(props: {
  query: string;
  ready: boolean;
  pending: boolean;
  error: boolean;
  resultCount: number;
  onRetry: () => void;
}) {
  if (!isConsumerTypeaheadReady(props.query)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scout-recorded coverage</CardTitle>
          <CardDescription>
            These profiles combine only accounts configured in Scout and games
            Scout ingested. They are not a complete Riot match history.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!props.ready || props.pending) {
    return <p className="text-sm text-scout-subtle">Searching players…</p>;
  }
  if (props.error) {
    return (
      <RetryCard
        title="Search didn't finish"
        description="Scout rechecks your shared servers for every search. Retry this request."
        onRetry={props.onRetry}
      />
    );
  }
  if (props.resultCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No recorded player matched</CardTitle>
          <CardDescription>
            Try another Scout alias or Riot ID. Players outside your enabled
            shared servers never appear in results.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <p className="text-sm text-scout-subtle" aria-live="polite">
      {props.resultCount.toString()} suggested
      {props.resultCount === 1 ? " player." : " players."}
    </p>
  );
}
