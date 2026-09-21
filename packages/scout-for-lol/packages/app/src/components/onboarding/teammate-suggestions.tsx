import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  Card,
  CardContent,
} from "@scout-for-lol/design-system/components/card";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";
import { useAddSubscription } from "#src/lib/player/use-add-subscription.ts";
import { ServerFormError } from "#src/components/semantic-form.tsx";
import { regionLabel } from "#src/lib/regions.ts";

type SuggestionsResult = RouterOutputs["player"]["suggestTeammates"];

function withoutAdded(
  previous: SuggestionsResult | undefined,
  addedPuuid: string,
): SuggestionsResult | undefined {
  if (previous?.kind !== "ok") return previous;
  return {
    kind: "ok",
    suggestions: previous.suggestions.filter(
      (suggestion) => suggestion.puuid !== addedPuuid,
    ),
  };
}

/**
 * "Played with recently" suggestions for the onboarding add-friends step.
 * Counts same-team teammates across the self alias's recent matches; every
 * pick still goes through the verified `subscription.add` flow.
 *
 * Renders nothing when there is no self alias or destination channel yet,
 * when the player is unknown, or when there are no suggestions — the manual
 * form below stays the fallback for every state.
 */
export function TeammateSuggestions(props: {
  guildId: string;
  channelId: string;
  selfAlias: string;
  onAdded: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // The PUUID just added. Removed from the cached list on success so one
  // click never refetches the backend's full Riot workload.
  const addedPuuid = useRef<string | null>(null);
  const suggestions = useQuery(
    trpc.player.suggestTeammates.queryOptions(
      { guildId: props.guildId, alias: props.selfAlias },
      {
        enabled: props.selfAlias.length > 0,
        // Visit-long snapshot: the list only changes through local adds
        // below, so background refetches would just re-spend Riot quota.
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
      },
    ),
  );
  const { submit, isPending, error } = useAddSubscription({
    guildId: props.guildId,
    onAdded: () => {
      const added = addedPuuid.current;
      addedPuuid.current = null;
      if (added !== null) {
        queryClient.setQueryData(
          trpc.player.suggestTeammates.queryOptions({
            guildId: props.guildId,
            alias: props.selfAlias,
          }).queryKey,
          (previous: SuggestionsResult | undefined) =>
            withoutAdded(previous, added),
        );
      }
      props.onAdded();
    },
  });

  if (props.selfAlias.length === 0 || props.channelId.length === 0) {
    return null;
  }
  if (suggestions.isPending) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-scout-subtle" role="status">
            Looking at your recent games for friends…
          </p>
        </CardContent>
      </Card>
    );
  }
  if (suggestions.isError) return null;
  const result = suggestions.data;
  if (result.kind === "player-not-found") return null;
  if (result.kind === "riot-unavailable") {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-scout-subtle" role="status">
            Couldn&apos;t reach recent-match data — add friends manually below.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (result.kind === "no-matches") {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-scout-subtle" role="status">
            No recent games found yet — once your first report lands,
            suggestions appear here.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (result.suggestions.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">Played with recently</p>
        <ul className="space-y-2">
          {result.suggestions.map((suggestion) => (
            <li
              key={suggestion.puuid}
              className="flex items-center gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {suggestion.riotId}
              </span>
              <Badge variant="secondary">
                {regionLabel(suggestion.region)}
              </Badge>
              <span className="shrink-0 text-xs text-scout-subtle">
                {suggestion.gamesTogether === 1
                  ? "1 game together"
                  : `${suggestion.gamesTogether.toString()} games together`}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  addedPuuid.current = suggestion.puuid;
                  submit({
                    channelId: props.channelId,
                    region: suggestion.region,
                    riotId: suggestion.riotId,
                    alias: suggestion.riotId,
                    discordUserId: "",
                    filters: null,
                  });
                }}
              >
                {isPending ? "Adding…" : "Add"}
              </Button>
            </li>
          ))}
        </ul>
        <ServerFormError error={error} />
      </CardContent>
    </Card>
  );
}
