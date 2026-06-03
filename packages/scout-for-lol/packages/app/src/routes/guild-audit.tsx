import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
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
  const { data, isLoading, error } = useQuery(
    trpc.subscription.listAuditLog.queryOptions(
      { guildId: safeGuildId, limit: 100 },
      { enabled: guildId !== undefined },
    ),
  );

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

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <p className="text-sm text-destructive">
          Failed to load: {error.message}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">No audit entries yet.</p>
      )}

      {data && data.length > 0 && (
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
              {data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.actorDiscordId}
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
    </div>
  );
}
