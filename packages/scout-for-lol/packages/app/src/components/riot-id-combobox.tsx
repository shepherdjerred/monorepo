import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RiotIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { regionLabel, type RegionValue } from "#src/lib/regions.ts";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import { Combobox } from "#src/components/ui/combobox.tsx";
import { Badge } from "#src/components/ui/badge.tsx";

type RiotItem =
  | { kind: "resolved"; gameName: string; tagLine: string; region: string }
  | {
      kind: "suggestion";
      gameName: string;
      tagLine: string;
      region: string;
      tier: string | null;
      avatar: string | null;
    };

function itemRiotId(item: RiotItem): string {
  return `${item.gameName}#${item.tagLine}`;
}

/**
 * Riot ID input with three suggestion sources: a live Riot exact-resolve of a
 * full `name#TAG` (the ✓ pick), plus partial-name suggestions from our own
 * summoner index and OP.GG. The text the user types IS the Riot ID form value;
 * selecting fills the canonical `gameName#tagLine` and reports the region.
 * Every pick is still Riot-verified by the add flow before it's stored.
 */
export function RiotIdCombobox(props: {
  guildId: string;
  region: RegionValue;
  value: string;
  onValueChange: (value: string) => void;
  onSelectAccount?: (account: { riotId: string; region: string }) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const trpc = useTRPC();
  const debounced = useDebouncedValue(props.value);
  const trimmed = debounced.trim();
  const exact = RiotIdSchema.safeParse(trimmed);

  const suggestQuery = useQuery(
    trpc.riot.searchSummoners.queryOptions(
      { guildId: props.guildId, query: trimmed, region: props.region },
      { enabled: trimmed.length >= 2, placeholderData: keepPreviousData },
    ),
  );
  const resolveQuery = useQuery(
    trpc.riot.resolveRiotId.queryOptions(
      { guildId: props.guildId, riotId: trimmed, region: props.region },
      { enabled: exact.success },
    ),
  );

  // Superseded query: the input is still debouncing (props.value hasn't reached
  // `debounced`/`trimmed`, so the query keys haven't caught up) or a new request
  // is in flight (keepPreviousData). In either case the visible results belong
  // to the previous query, so surface nothing rather than a stale, selectable
  // list.
  const debouncePending = props.value.trim() !== trimmed;

  const items: RiotItem[] = [];
  const seen = new Set<string>();
  const push = (item: RiotItem) => {
    // Region is part of the identity: the same Riot ID can exist on several
    // regions, and collapsing them let whichever row happened to survive
    // silently decide the account's region for the user.
    const key = `${item.gameName.toLowerCase()}#${item.tagLine.toLowerCase()}#${item.region}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  if (!debouncePending && resolveQuery.data?.kind === "ok") {
    push({
      kind: "resolved",
      gameName: resolveQuery.data.gameName,
      tagLine: resolveQuery.data.tagLine,
      region: props.region,
    });
  }
  const suggestions =
    debouncePending || suggestQuery.isPlaceholderData
      ? []
      : (suggestQuery.data ?? []);
  for (const suggestion of suggestions) {
    push({ kind: "suggestion", ...suggestion });
  }

  return (
    <Combobox<RiotItem>
      value={props.value}
      onValueChange={props.onValueChange}
      items={items}
      isLoading={suggestQuery.isFetching || resolveQuery.isFetching}
      getKey={(item) => `${item.kind}:${itemRiotId(item)}:${item.region}`}
      onSelect={(item) => {
        props.onValueChange(itemRiotId(item));
        if (item.kind === "suggestion") {
          props.onSelectAccount?.({
            riotId: itemRiotId(item),
            region: item.region,
          });
        }
      }}
      disabled={props.disabled}
      placeholder={props.placeholder ?? "name#TAG"}
      className={props.className}
      id={props.id}
      renderItem={(item) =>
        item.kind === "resolved" ? (
          <span className="flex w-full items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400">
              ✓
            </span>
            <span className="truncate">
              {item.gameName}
              <span className="text-muted-foreground">#{item.tagLine}</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <Badge variant="secondary">{regionLabel(item.region)}</Badge>
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                Exact match
              </span>
            </span>
          </span>
        ) : (
          <span className="flex w-full items-center gap-2">
            {item.avatar === null ? (
              <span className="h-5 w-5 shrink-0 rounded-full bg-muted" />
            ) : (
              <img
                src={item.avatar}
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 shrink-0 rounded-full"
              />
            )}
            <span className="truncate">
              {item.gameName}
              <span className="text-muted-foreground">#{item.tagLine}</span>
              {item.tier !== null && (
                <span className="text-muted-foreground"> · {item.tier}</span>
              )}
            </span>
            {/* Region is shown on every row so a same-name account on another
                region is never mistaken for the exact match above. */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <Badge variant="secondary">{regionLabel(item.region)}</Badge>
              <span className="text-xs text-muted-foreground">Suggestion</span>
            </span>
          </span>
        )
      }
    />
  );
}
