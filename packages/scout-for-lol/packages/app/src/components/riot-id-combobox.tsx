import { useQuery } from "@tanstack/react-query";
import { RiotIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import type { RegionValue } from "#src/lib/regions.ts";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import { Combobox } from "#src/components/ui/combobox.tsx";

type RiotItem =
  | { kind: "resolved"; gameName: string; tagLine: string }
  | {
      kind: "suggestion";
      gameName: string;
      tagLine: string;
      region: string;
      tier: string | null;
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
      { enabled: trimmed.length >= 2 },
    ),
  );
  const resolveQuery = useQuery(
    trpc.riot.resolveRiotId.queryOptions(
      { guildId: props.guildId, riotId: trimmed, region: props.region },
      { enabled: exact.success },
    ),
  );

  const items: RiotItem[] = [];
  const seen = new Set<string>();
  const push = (item: RiotItem) => {
    const key = `${item.gameName.toLowerCase()}#${item.tagLine.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  if (resolveQuery.data?.kind === "ok") {
    push({
      kind: "resolved",
      gameName: resolveQuery.data.gameName,
      tagLine: resolveQuery.data.tagLine,
    });
  }
  for (const suggestion of suggestQuery.data ?? []) {
    push({ kind: "suggestion", ...suggestion });
  }

  return (
    <Combobox<RiotItem>
      value={props.value}
      onValueChange={props.onValueChange}
      items={items}
      isLoading={suggestQuery.isFetching || resolveQuery.isFetching}
      getKey={(item) => `${item.kind}:${itemRiotId(item)}`}
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
          <span className="truncate">
            <span className="text-emerald-600 dark:text-emerald-400">✓ </span>
            {item.gameName}
            <span className="text-muted-foreground">#{item.tagLine}</span>
          </span>
        ) : (
          <span className="truncate">
            {item.gameName}
            <span className="text-muted-foreground">#{item.tagLine}</span>
            {item.tier !== null && (
              <span className="text-muted-foreground"> · {item.tier}</span>
            )}
          </span>
        )
      }
    />
  );
}
