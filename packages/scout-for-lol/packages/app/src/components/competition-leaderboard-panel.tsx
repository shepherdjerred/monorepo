import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CompetitionId,
  type CompetitionStatus,
  RankSchema,
  rankToString,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { formatDate } from "#src/lib/format.ts";
import { Button } from "#src/components/ui/button.tsx";
import { ChartImage } from "#src/components/chart-image.tsx";
import { Section } from "#src/components/section.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

function formatScore(score: unknown): string {
  const rankResult = RankSchema.safeParse(score);
  if (rankResult.success) {
    return rankToString(rankResult.data);
  }
  if (typeof score === "number") {
    return Number.isInteger(score) ? score.toString() : score.toFixed(2);
  }
  return String(score);
}

export function CompetitionLeaderboardPanel(props: {
  guildId: string;
  competitionId: CompetitionId;
  status: CompetitionStatus;
}) {
  const { guildId, competitionId, status } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [chartBust, setChartBust] = useState(0);

  const leaderboardKey = trpc.competition.leaderboard.queryKey({
    guildId,
    competitionId,
  });
  const leaderboardQuery = useQuery(
    trpc.competition.leaderboard.queryOptions(
      { guildId, competitionId },
      { enabled: status !== "DRAFT" },
    ),
  );
  const refreshMutation = useMutation(
    trpc.competition.refreshLeaderboard.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: leaderboardKey });
        setChartBust((prev) => prev + 1);
      },
    }),
  );

  const refreshButton =
    status === "ACTIVE" ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={refreshMutation.isPending}
        onClick={() => {
          refreshMutation.mutate({ guildId, competitionId });
        }}
      >
        {refreshMutation.isPending ? "Refreshing…" : "Refresh standings"}
      </Button>
    ) : undefined;

  const leaderboard = leaderboardQuery.data;
  const chartSrc = `/api/competition/${competitionId.toString()}/leaderboard.png?t=${chartBust.toString()}`;

  return (
    <Section title="Standings" action={refreshButton}>
      <div className="space-y-3 p-3">
        {refreshMutation.error && (
          <p className="text-sm text-destructive">
            {refreshMutation.error.message}
          </p>
        )}
        {status === "DRAFT" && (
          <p className="text-sm text-muted-foreground">
            Standings appear once the competition starts.
          </p>
        )}
        {status !== "DRAFT" && leaderboardQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Loading standings…</p>
        )}
        {status !== "DRAFT" && leaderboardQuery.data === null && (
          <p className="text-sm text-muted-foreground">
            No standings computed yet.
            {status === "ACTIVE"
              ? " Click “Refresh standings” to generate them."
              : ""}
          </p>
        )}

        {leaderboard && leaderboard.entries.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              Updated {formatDate(leaderboard.calculatedAt)}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.entries.map((entry) => (
                  <TableRow key={entry.playerId}>
                    <TableCell>{entry.rank}</TableCell>
                    <TableCell className="font-medium">
                      {entry.playerName}
                    </TableCell>
                    <TableCell>{formatScore(entry.score)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ChartImage src={chartSrc} alt="Leaderboard chart" />
          </>
        )}
      </div>
    </Section>
  );
}
