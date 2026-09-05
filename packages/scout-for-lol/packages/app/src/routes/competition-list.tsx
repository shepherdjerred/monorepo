import { Loaded } from "@shepherdjerred/loaded";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  competitionGameVariantToString,
  visibilityToString,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { formatDate } from "#src/lib/format.ts";
import { summarizeCriteria } from "#src/lib/criteria-summary.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { LoadMore } from "#src/components/load-more.tsx";
import { CompetitionStatusBadge } from "#src/components/status-badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";

export function CompetitionList() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const { perms } = usePermissions(guildId);
  // Default to hiding cancelled/ended competitions; the toggle shows all.
  const [activeOnly, setActiveOnly] = useState(true);
  const safeGuildId = guildId ?? "";

  const competitionsQuery = useInfiniteQuery(
    trpc.competition.list.infiniteQueryOptions(
      { guildId: safeGuildId, activeOnly, limit: 50 },
      {
        enabled: guildId !== undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: STALE_TIME_SLOW_LIST,
      },
    ),
  );

  const competitionsValue = Loaded.fromQuery(competitionsQuery, [
    "competition.list",
  ]);

  if (guildId === undefined) {
    return <p className="text-sm text-scout-danger">Missing guild id</p>;
  }

  const competitions = Loaded.getOrElse(
    Loaded.map(competitionsValue, (data) =>
      data.pages.flatMap((page) => page.items),
    ),
    [],
  );

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
          {perms.can("competitions", "create") && (
            <Button asChild size="sm">
              <Link to={`/g/${guildId}/competitions/new`}>
                + New competition
              </Link>
            </Button>
          )}
        </div>
      </div>

      {competitionsValue.status === "loading" && (
        <p className="text-sm text-scout-subtle">Loading competitions…</p>
      )}
      {(competitionsValue.status === "error" ||
        competitionsValue.status === "degraded") && (
        <p className="text-sm text-scout-danger">
          Failed to load: {Loaded.messageOf(competitionsValue.errors[0].error)}
        </p>
      )}

      {competitionsValue.status !== "loading" && competitions.length === 0 && (
        <p className="text-sm text-scout-subtle">
          No competitions yet — click &quot;New competition&quot; to get
          started.
        </p>
      )}

      {competitions.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <caption className="sr-only">Competitions</caption>
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
                      className="underline"
                      to={`/g/${guildId}/competitions/${competition.id.toString()}`}
                    >
                      {competition.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CompetitionStatusBadge status={competition.status} />
                  </TableCell>
                  <TableCell className="text-scout-subtle">
                    <span className="block text-scout-ink">
                      {competitionGameVariantToString(competition.gameVariant)}
                    </span>
                    {summarizeCriteria(competition.criteria)}
                  </TableCell>
                  <TableCell className="text-scout-subtle">
                    {formatDate(competition.startDate)} →{" "}
                    {formatDate(competition.endDate)}
                  </TableCell>
                  <TableCell>{competition.participantCount}</TableCell>
                  <TableCell className="text-scout-subtle">
                    {visibilityToString(competition.visibility)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <LoadMore
        hasNextPage={competitionsQuery.hasNextPage}
        isFetchingNextPage={competitionsQuery.isFetchingNextPage}
        onLoadMore={() => {
          void competitionsQuery.fetchNextPage();
        }}
      />
    </div>
  );
}
