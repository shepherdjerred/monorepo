import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import { Combobox } from "#src/components/ui/combobox.tsx";

type KnownAccount = {
  accountId: number;
  alias: string;
  region: string;
  riotGameName: string | null;
  riotTagLine: string | null;
  player: { id: number; alias: string };
};

function accountRiotId(account: KnownAccount): string {
  return account.riotGameName === null
    ? account.alias
    : `${account.riotGameName}#${account.riotTagLine ?? ""}`;
}

/**
 * Riot ID input with typeahead over this guild's already-known accounts
 * (matched by alias or cached game name). The text the user types IS the
 * Riot ID form value; selecting a suggestion fills the canonical
 * `gameName#tagLine` and reports the account's region so the parent can
 * pre-fill its region select. Brand-new Riot IDs are still typed in full.
 */
export function RiotIdCombobox(props: {
  guildId: string;
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
  const search = useQuery(
    trpc.riot.searchKnownAccounts.queryOptions(
      { guildId: props.guildId, query: debounced.trim() },
      { enabled: debounced.trim().length > 0 },
    ),
  );

  return (
    <Combobox<KnownAccount>
      value={props.value}
      onValueChange={props.onValueChange}
      items={search.data ?? []}
      isLoading={search.isFetching}
      getKey={(account) => account.accountId.toString()}
      onSelect={(account) => {
        const riotId = accountRiotId(account);
        props.onValueChange(riotId);
        props.onSelectAccount?.({ riotId, region: account.region });
      }}
      disabled={props.disabled}
      placeholder={props.placeholder ?? "name#TAG"}
      emptyText="No known accounts match — type a full Riot ID."
      className={props.className}
      id={props.id}
      renderItem={(account) => (
        <span className="truncate">
          {accountRiotId(account)}
          <span className="text-muted-foreground">
            {" "}
            ({account.region}) — {account.player.alias}
          </span>
        </span>
      )}
    />
  );
}
