import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { useDuelEventParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function DuelStandings() {
  const { guildId, eventId } = useDuelEventParams();
  const trpc = useTRPC();
  const event = useQuery(trpc.duel.event.queryOptions({ guildId, eventId }));
  const standings = useQuery(
    trpc.duel.standings.queryOptions({ guildId, eventId }),
  );
  if (event.isPending || standings.isPending)
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-scout-subtle">
        Loading standings…
      </div>
    );
  if (event.isError || standings.isError)
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-scout-danger">
        {event.error?.message ?? standings.error?.message}
      </div>
    );
  const entrantNames = new Map(
    event.data.entrants.map((entrant) => [
      entrant.competitor.id,
      entrant.competitor.teamName ??
        entrant.competitor.accounts
          .map((account) => account.playerAlias)
          .join(" + "),
    ]),
  );
  const ranks = new Map(
    standings.data.ranks?.map((rank) => [rank.competitorId, rank]),
  );
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-12">
      <Link
        className="text-sm text-scout-subtle hover:underline"
        to={`/duels/${guildId}/events/${eventId}`}
      >
        ← {event.data.name}
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Standings</h1>
        <p className="mt-2 text-scout-subtle">
          Series wins, two-way head-to-head, then game differential. Remaining
          ties require a tiebreak series.
        </p>
      </header>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Entrant</TableHead>
            <TableHead>Games</TableHead>
            <TableHead>Series</TableHead>
            <TableHead>Win rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.data.standings
            .toSorted(
              (left, right) =>
                (ranks.get(left.competitorId)?.rank ??
                  Number.MAX_SAFE_INTEGER) -
                  (ranks.get(right.competitorId)?.rank ??
                    Number.MAX_SAFE_INTEGER) ||
                right.seriesWins - left.seriesWins,
            )
            .map((standing) => {
              const rank = ranks.get(standing.competitorId);
              return (
                <TableRow key={standing.competitorId}>
                  <TableCell>
                    {rank?.rank ?? "—"}
                    {rank?.needsTiebreak === true ? (
                      <Badge className="ml-2" variant="outline">
                        tiebreak
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">
                    {entrantNames.get(standing.competitorId) ??
                      standing.competitorId}
                  </TableCell>
                  <TableCell>
                    {standing.wins.toString()}–{standing.losses.toString()}
                  </TableCell>
                  <TableCell>
                    {standing.seriesWins.toString()}–
                    {standing.seriesLosses.toString()}
                  </TableCell>
                  <TableCell>
                    {standing.placed && standing.winRate !== null
                      ? `${Math.round(standing.winRate * 100).toString()}%`
                      : "Unplaced"}
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}
