import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CompetitionId,
  type CompetitionStatus,
  type CompetitionAnalysisPreset,
  type VisualizationSnapshot,
  RankSchema,
  rankToString,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { competitionAnalysisDateInput } from "#src/lib/competition-analysis-date.ts";
import { formatDate } from "#src/lib/format.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { Button } from "#src/components/ui/button.tsx";
import { ChartImage } from "#src/components/chart-image.tsx";
import { Section } from "#src/components/section.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";
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
  startDate: Date | string | null;
  endDate: Date | string | null;
  analysisTimezone: string;
}) {
  const { guildId, competitionId, status } = props;
  const trpc = useTRPC();
  const { perms } = usePermissions(guildId);
  const queryClient = useQueryClient();
  const [chartBust, setChartBust] = useState(0);
  const [mode, setMode] = useState<"official" | "selected_period">("official");
  const [preset, setPreset] =
    useState<CompetitionAnalysisPreset>("criterion_score");
  const [startDate, setStartDate] = useState(
    competitionAnalysisDateInput(props.startDate, props.analysisTimezone),
  );
  const [endDate, setEndDate] = useState(
    competitionAnalysisDateInput(props.endDate, props.analysisTimezone),
  );
  const [timezone, setTimezone] = useState(props.analysisTimezone);

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
  const analysisQuery = useQuery(
    trpc.competition.analysis.queryOptions(
      {
        guildId,
        competitionId,
        mode,
        preset,
        ...(startDate === "" ? {} : { startDate }),
        ...(endDate === "" ? {} : { endDate }),
      },
      { enabled: status !== "DRAFT" },
    ),
  );
  const timezoneMutation = useMutation(
    trpc.competition.setAnalysisTimezone.mutationOptions({
      onSuccess: () => {
        void analysisQuery.refetch();
      },
    }),
  );
  const refreshMutation = useMutation(
    trpc.competition.refreshLeaderboard.mutationOptions({
      meta: analyticsMeta("competition_leaderboard_refreshed"),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: leaderboardKey });
        void analysisQuery.refetch();
        setChartBust((prev) => prev + 1);
      },
    }),
  );

  const refreshButton =
    status === "ACTIVE" && perms.can("competitions", "refresh") ? (
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
        <AnalysisControls
          mode={mode}
          preset={preset}
          startDate={startDate}
          endDate={endDate}
          timezone={timezone}
          canSaveTimezone={perms.can("competitions", "update")}
          isSavingTimezone={timezoneMutation.isPending}
          onModeChange={setMode}
          onPresetChange={setPreset}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onTimezoneChange={setTimezone}
          onSaveTimezone={() => {
            timezoneMutation.mutate({ guildId, competitionId, timezone });
          }}
        />
        <StandingsStatus
          status={status}
          isLoading={leaderboardQuery.isLoading}
          isEmpty={leaderboardQuery.data === null}
          analysisError={analysisQuery.error?.message}
          refreshError={refreshMutation.error?.message}
        />
        <OfficialStandings
          visible={mode === "official" && preset === "criterion_score"}
          leaderboard={leaderboard}
          chartSrc={chartSrc}
        />
        <PeriodAnalysis
          visible={mode === "selected_period" || preset !== "criterion_score"}
          analysis={analysisQuery.data}
        />
      </div>
    </Section>
  );
}

type StandingsEntry = {
  playerId: number;
  playerName: string;
  rank: number;
  score: unknown;
};

function AnalysisControls(props: {
  mode: "official" | "selected_period";
  preset: CompetitionAnalysisPreset;
  startDate: string;
  endDate: string;
  timezone: string;
  canSaveTimezone: boolean;
  isSavingTimezone: boolean;
  onModeChange: (mode: "official" | "selected_period") => void;
  onPresetChange: (preset: CompetitionAnalysisPreset) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onSaveTimezone: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={props.mode === "official" ? "default" : "outline"}
          onClick={() => {
            props.onModeChange("official");
          }}
        >
          Official
        </Button>
        <Button
          type="button"
          size="sm"
          variant={props.mode === "selected_period" ? "default" : "outline"}
          onClick={() => {
            props.onModeChange("selected_period");
          }}
        >
          Selected period
        </Button>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={props.preset}
          onChange={(event) => {
            props.onPresetChange(parsePreset(event.target.value));
          }}
        >
          <option value="criterion_score">Criterion score</option>
          <option value="rank_position">Rank position</option>
          <option value="games_wins">Games and wins</option>
          <option value="performance">Win rate and KDA</option>
          <option value="champion_queue_composition">Queue composition</option>
        </select>
      </div>
      {props.mode === "selected_period" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            type="date"
            aria-label="Competition analysis start date"
            value={props.startDate}
            onChange={(event) => {
              props.onStartDateChange(event.target.value);
            }}
          />
          <Input
            type="date"
            aria-label="Competition analysis end date"
            value={props.endDate}
            onChange={(event) => {
              props.onEndDateChange(event.target.value);
            }}
          />
        </div>
      )}
      <div className="flex gap-2">
        <Input
          aria-label="Competition analysis timezone"
          value={props.timezone}
          onChange={(event) => {
            props.onTimezoneChange(event.target.value);
          }}
        />
        {props.canSaveTimezone && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.isSavingTimezone}
            onClick={props.onSaveTimezone}
          >
            Save timezone
          </Button>
        )}
      </div>
    </>
  );
}

function StandingsStatus(props: {
  status: CompetitionStatus;
  isLoading: boolean;
  isEmpty: boolean;
  analysisError: string | undefined;
  refreshError: string | undefined;
}) {
  return (
    <>
      {props.analysisError !== undefined && (
        <p className="text-sm text-destructive">{props.analysisError}</p>
      )}
      {props.refreshError !== undefined && (
        <p className="text-sm text-destructive">{props.refreshError}</p>
      )}
      {props.status === "DRAFT" && (
        <p className="text-sm text-muted-foreground">
          Standings appear once the competition starts.
        </p>
      )}
      {props.status !== "DRAFT" && props.isLoading && (
        <p className="text-sm text-muted-foreground">Loading standings…</p>
      )}
      {props.status !== "DRAFT" && props.isEmpty && (
        <p className="text-sm text-muted-foreground">
          No standings computed yet.
          {props.status === "ACTIVE"
            ? " Click “Refresh standings” to generate them."
            : ""}
        </p>
      )}
    </>
  );
}

function StandingsTable(props: { entries: StandingsEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Player</TableHead>
          <TableHead>Score</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.entries.map((entry) => (
          <TableRow key={entry.playerId}>
            <TableCell>{entry.rank}</TableCell>
            <TableCell className="font-medium">{entry.playerName}</TableCell>
            <TableCell>{formatScore(entry.score)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OfficialStandings(props: {
  visible: boolean;
  leaderboard:
    | { calculatedAt: Date | string; entries: StandingsEntry[] }
    | null
    | undefined;
  chartSrc: string;
}) {
  if (!props.visible || props.leaderboard?.entries.length === 0) return null;
  if (props.leaderboard === null || props.leaderboard === undefined)
    return null;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Updated {formatDate(props.leaderboard.calculatedAt)}
      </p>
      <StandingsTable entries={props.leaderboard.entries} />
      <ChartImage src={props.chartSrc} alt="Leaderboard chart" />
    </>
  );
}

function PeriodAnalysis(props: {
  visible: boolean;
  analysis:
    | {
        standings: StandingsEntry[];
        visualization: VisualizationSnapshot | null;
        rowsScanned: number;
      }
    | undefined;
}) {
  if (!props.visible || props.analysis === undefined) return null;
  return (
    <>
      {props.analysis.standings.length > 0 && (
        <StandingsTable entries={props.analysis.standings} />
      )}
      {props.analysis.visualization !== null && (
        <InteractiveVisualization snapshot={props.analysis.visualization} />
      )}
      <p className="text-xs text-muted-foreground">
        {props.analysis.rowsScanned.toLocaleString()} analysis rows scanned
      </p>
    </>
  );
}

function parsePreset(value: string): CompetitionAnalysisPreset {
  if (
    value === "criterion_score" ||
    value === "rank_position" ||
    value === "games_wins" ||
    value === "performance" ||
    value === "champion_queue_composition"
  ) {
    return value;
  }
  throw new Error(`Unknown competition analysis preset ${value}.`);
}
