import { useQuery } from "@tanstack/react-query";
import { formatInteger } from "@scout-for-lol/data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import { useDiscordNames } from "#src/hooks/use-discord-names.ts";
import { formatDate } from "#src/lib/format.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/api/stale-times.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { useBucksGuild } from "#src/routes/bucks-workspace.tsx";

/**
 * The most recent Friday standings — a snapshot of what the weekly Discord
 * post already disclosed, deliberately never a live leaderboard.
 */
export function BucksLeaderboard() {
  const { guildId } = useBucksGuild();
  const trpc = useTRPC();
  const query = useQuery(
    trpc.bucks.leaderboard.queryOptions(
      { guildId },
      { staleTime: STALE_TIME_SLOW_LIST },
    ),
  );
  const names = useDiscordNames(
    query.data?.kind === "snapshot"
      ? query.data.entries.map((entry) => entry.discordId)
      : [],
  );

  if (query.isPending) {
    return <LoadingState label="Loading the weekly leaderboard…" />;
  }
  if (query.isError) {
    return (
      <ErrorState
        message="Scout couldn't load the weekly leaderboard."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const snapshot = query.data;
  if (snapshot.kind !== "snapshot") {
    return (
      <EmptyState>
        <p>
          No weekly standings have been posted yet. The leaderboard is published
          to Discord every Friday and mirrored here.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-scout-subtle text-sm">
        As of {formatDate(snapshot.postedAt)} — the standings the weekly Discord
        post disclosed, not live balances.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Member</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.entries.map((entry) => (
            <TableRow key={entry.discordId}>
              <TableCell>{formatInteger(entry.rank)}</TableCell>
              <TableCell>
                {names.resolve(entry.discordId)?.displayName ?? entry.discordId}
              </TableCell>
              <TableCell className="text-right">
                {formatInteger(entry.balance)} BB
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
