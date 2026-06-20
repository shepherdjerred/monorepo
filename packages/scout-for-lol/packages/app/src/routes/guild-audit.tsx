import { useParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { DiscordUser } from "#src/components/discord-user.tsx";
import { LoadMore } from "#src/components/load-more.tsx";
import { useDiscordNames } from "#src/hooks/use-discord-names.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

export function GuildAudit() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const safeGuildId = guildId ?? "";
  const query = useInfiniteQuery(
    trpc.subscription.listAuditLog.infiniteQueryOptions(
      { guildId: safeGuildId, limit: 50 },
      {
        enabled: guildId !== undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  // Audit actors aren't necessarily stored players, so resolve their names
  // via the batch hook rather than relying on payload enrichment.
  const names = useDiscordNames(rows.map((row) => row.actorDiscordId));

  if (guildId === undefined) {
    return (
      <div>
        <p className="text-sm text-destructive">Missing guild id</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Audit log</h2>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {query.error && (
        <p className="text-sm text-destructive">
          Failed to load: {query.error.message}
        </p>
      )}

      {query.data && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No audit entries yet.</p>
      )}

      {query.data && rows.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <DiscordUser
                      id={row.actorDiscordId}
                      name={names.resolve(row.actorDiscordId)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{row.action}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.targetChannelId ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.targetPlayerId ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.targetAccountId ?? "—"}
                  </TableCell>
                  <TableCell>
                    <pre className="m-0 max-w-md overflow-x-auto rounded-sm bg-muted p-2 text-xs">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <LoadMore
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => {
          void query.fetchNextPage();
        }}
      />
    </div>
  );
}
