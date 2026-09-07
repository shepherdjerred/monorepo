import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  EXPLORE_SUGGESTIONS,
  PERSISTENT_EXPLORE_SUGGESTION,
  pickDiverseSuggestions,
  type ExploreFeatureContext,
} from "#src/components/explore/explore-suggestions.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function ExploreSuggestionChips(props: {
  readonly onSelect: (prompt: string) => void;
  readonly enabled?: boolean;
}) {
  const { onSelect, enabled = true } = props;
  const trpc = useTRPC();

  const bucksQuery = useQuery({
    ...trpc.bucks.status.queryOptions(),
    enabled,
  });
  const challengesQuery = useQuery({
    ...trpc.challenge.status.queryOptions(),
    enabled,
  });
  const guildsQuery = useQuery({
    ...trpc.guild.listManageable.queryOptions(),
    enabled,
  });

  const featureContext = useMemo<ExploreFeatureContext>(
    () => ({
      bucksEnabled: bucksQuery.data?.state === "available",
      daresEnabled:
        bucksQuery.data?.state === "available" &&
        bucksQuery.data.guilds.some((g) => g.daresAvailable),
      challengesEnabled: challengesQuery.data?.enabled ?? false,
      competitionsEnabled: (guildsQuery.data?.length ?? 0) > 0,
      reportsEnabled: (guildsQuery.data?.length ?? 0) > 0,
      customsEnabled:
        guildsQuery.data?.some((g) => g.customNightsEnabled) ?? false,
      hallOfFameEnabled:
        guildsQuery.data?.some((g) => g.hallOfFameEnabled) ?? false,
    }),
    [bucksQuery.data, challengesQuery.data, guildsQuery.data],
  );

  const [suggestionChips, setSuggestionChips] = useState<string[]>(() =>
    pickDiverseSuggestions(
      EXPLORE_SUGGESTIONS,
      {},
      { count: 4, exclude: [PERSISTENT_EXPLORE_SUGGESTION] },
    ),
  );

  useEffect(() => {
    setSuggestionChips((prev) =>
      pickDiverseSuggestions(EXPLORE_SUGGESTIONS, featureContext, {
        count: 4,
        exclude: [PERSISTENT_EXPLORE_SUGGESTION, ...prev],
      }),
    );
  }, [featureContext]);

  const handleShuffle = useCallback(() => {
    setSuggestionChips((prev) =>
      pickDiverseSuggestions(EXPLORE_SUGGESTIONS, featureContext, {
        count: 4,
        exclude: [PERSISTENT_EXPLORE_SUGGESTION, ...prev],
      }),
    );
  }, [featureContext]);

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm">
          Ask about champions, queues, positions, patches, or players across
          every match Scout has ingested.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 text-xs text-scout-subtle hover:text-scout-ink"
          onClick={handleShuffle}
          title="Show different suggestions"
          aria-label="Show different suggestions"
        >
          <RefreshCw className="size-3.5" />
          <span className="hidden sm:inline">Shuffle</span>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="border-scout-border/80 font-medium hover:border-scout-primary/40 hover:bg-scout-surface-hover"
          onClick={() => {
            onSelect(PERSISTENT_EXPLORE_SUGGESTION);
          }}
        >
          <Sparkles className="mr-1.5 size-3.5 text-scout-primary" />
          {PERSISTENT_EXPLORE_SUGGESTION}
        </Button>
        {suggestionChips.map((example) => (
          <Button
            key={example}
            variant="outline"
            size="sm"
            onClick={() => {
              onSelect(example);
            }}
          >
            {example}
          </Button>
        ))}
      </div>
    </div>
  );
}
