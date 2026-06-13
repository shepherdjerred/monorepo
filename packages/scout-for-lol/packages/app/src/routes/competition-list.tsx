import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { visibilityToString } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { formatDate } from "#src/lib/format.ts";
import { summarizeCriteria } from "#src/lib/criteria-summary.ts";
import { Button } from "#src/components/ui/button.tsx";
import { CompetitionStatusBadge } from "#src/components/status-badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

export function CompetitionList() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const [activeOnly, setActiveOnly] = useState(false);
  const safeGuildId = guildId ?? "";

  const competitionsQuery = useQuery(
    trpc.competition.list.queryOptions(
      { guildId: safeGuildId, activeOnly },
      { enabled: guildId !== undefined },
    ),
  );

  if (guildId === undefined) {
    return <p className="text-sm text-destructive">Missing guild id</p>;
  }

  const competitions = competitionsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Competitions</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={activeOnly ? "default" : "outline"}
            onClick={() => {
              setActiveOnly((prev) => !prev);
            }}
          >
            {activeOnly ? "Active only" : "All"}
          </Button>
          <Button asChild size="sm">
            <Link to={`/g/${guildId}/competitions/new`}>+ New competition</Link>
          </Button>
        </div>
      </div>

      {competitionsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading competitions…</p>
      )}
      {competitionsQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load: {competitionsQuery.error.message}
        </p>
      )}

      {competitionsQuery.data && competitions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No competitions yet — click &quot;New competition&quot; to get
          started.
        </p>
      )}

      {competitions.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criteria</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Players</TableHead>
                <TableHead>Visibility</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competitions.map((competition) => (
                <TableRow key={competition.id}>
                  <TableCell className="font-medium">
                    <Link
                      className="hover:underline"
                      to={`/g/${guildId}/competitions/${competition.id.toString()}`}
                    >
                      {competition.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CompetitionStatusBadge status={competition.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {summarizeCriteria(competition.criteria)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(competition.startDate)} →{" "}
                    {formatDate(competition.endDate)}
                  </TableCell>
                  <TableCell>{competition.participantCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {visibilityToString(competition.visibility)}
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
