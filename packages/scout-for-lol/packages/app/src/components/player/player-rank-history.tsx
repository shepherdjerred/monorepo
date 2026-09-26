import { format as echartsFormat } from "echarts";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import {
  leaguePointsToRankLabel,
  rankToString,
  type Rank,
  type RankedQueueType,
} from "@scout-for-lol/data";
import { VISUALIZATION_BODY_FONT } from "@scout-for-lol/report/browser";
import {
  ProfileEchartsHost,
  profileChartChrome,
} from "#src/lib/echarts/profile-chart.tsx";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@scout-for-lol/design-system/components/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { RankValue } from "#src/components/player/player-profile-sections.tsx";

type RankHistoryPointView = {
  at: Date | string;
  leaguePoints: number;
  rank: Rank;
};

type QueueRankHistoryView = {
  series: { accountLabel: string; points: RankHistoryPointView[] }[];
  previous: {
    splitId: string;
    displayName: string;
    peak: Rank;
    last: Rank;
  }[];
};

export type RankHistoryView = {
  currentSplit: {
    id: string;
    displayName: string;
    start: Date | string;
    end: Date | string;
  };
  queues: Record<RankedQueueType, QueueRankHistoryView>;
};

const QUEUE_TABS = [
  { queue: "solo", label: "Solo / duo" },
  { queue: "flex", label: "Flex" },
  { queue: "ranked 5s", label: "Ranked 5s" },
] as const satisfies readonly { queue: RankedQueueType; label: string }[];

export function queueHasCurrentPoints(queue: QueueRankHistoryView): boolean {
  return queue.series.some((series) => series.points.length > 0);
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function PlayerRankHistoryPanel(props: {
  status: "loading" | "error" | "ready";
  history: RankHistoryView | undefined;
  onRetry: () => void;
}) {
  if (props.status === "loading") {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Ranked history</h2>
        <p className="text-sm text-scout-subtle">Loading ranked history…</p>
      </section>
    );
  }
  if (props.status === "error" || props.history === undefined) {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Ranked history</h2>
        <Card>
          <CardHeader>
            <CardTitle>Could not load ranked history</CardTitle>
            <CardDescription>
              Scout could not read this player&apos;s rank snapshots. Try again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={props.onRetry}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }
  return <PlayerRankHistoryCard history={props.history} />;
}

export function PlayerRankHistoryCard(props: { history: RankHistoryView }) {
  const { history } = props;
  const [period, setPeriod] = useState<RankHistoryPeriod>("season");
  const granularity = periodGranularity(period);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Ranked history</h2>
        <p className="text-sm text-scout-subtle">
          Live post-match snapshots Scout recorded for{" "}
          {history.currentSplit.displayName},{" "}
          {granularity === "game"
            ? "plotted per game"
            : "plotted as daily closes"}
          . This is not a Riot career graph, and it does not change with the
          game filters below.
        </p>
      </div>
      <Tabs defaultValue="solo">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label="Ranked queues">
            {QUEUE_TABS.map((tab) => (
              <TabsTrigger key={tab.queue} value={tab.queue}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div role="group" aria-label="History period" className="flex gap-1">
            {RANK_HISTORY_PERIOD_ORDER.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={value === period ? "secondary" : "ghost"}
                aria-pressed={value === period}
                onClick={() => {
                  setPeriod(value);
                }}
              >
                {periodLabel(value)}
              </Button>
            ))}
          </div>
        </div>
        {QUEUE_TABS.map((tab) => (
          <TabsContent key={tab.queue} value={tab.queue} className="space-y-4">
            <QueueRankHistory
              queueLabel={tab.label}
              splitName={history.currentSplit.displayName}
              start={asDate(history.currentSplit.start)}
              end={asDate(history.currentSplit.end)}
              period={period}
              queue={history.queues[tab.queue]}
            />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function QueueRankHistory(props: {
  queueLabel: string;
  splitName: string;
  start: Date;
  end: Date;
  period: RankHistoryPeriod;
  queue: QueueRankHistoryView;
}) {
  const range = periodRange(props.period, props.start, props.end);
  const prepared = preparePeriodSeries(props.queue.series, props.period, range);
  const hasVisible = prepared.some((entry) => entry.points.length > 0);
  let body: ReactNode;
  if (!queueHasCurrentPoints(props.queue)) {
    body = (
      <p className="text-sm text-scout-subtle">
        Scout has no ranked snapshots for this queue in {props.splitName}. Rank
        history starts when Scout processes a live ranked game.
      </p>
    );
  } else if (hasVisible) {
    body = (
      <RankHistoryChart
        title={`${props.queueLabel} · ${props.splitName}`}
        range={range}
        series={prepared}
      />
    );
  } else {
    body = (
      <p className="text-sm text-scout-subtle">
        {emptyRangeMessage(props.period)}
      </p>
    );
  }
  return (
    <>
      {body}
      {props.queue.previous.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Previous seasons
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Season</TableHead>
                <TableHead>Peak</TableHead>
                <TableHead>Last observed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.queue.previous.map((row) => (
                <TableRow key={row.splitId}>
                  <TableCell>{row.displayName}</TableCell>
                  <TableCell>
                    <RankValue rank={row.peak} compact />
                  </TableCell>
                  <TableCell>
                    <RankValue rank={row.last} compact />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

/**
 * Right edge of the ranked-history x-axis.
 *
 * The backend reports the split window, whose end is in the future
 * mid-split; rendering it verbatim stretches the axis past today and
 * compresses the real snapshots into the left half.
 */
export function graphXAxisMax(end: Date, now: Date = new Date()): number {
  return Math.min(end.getTime(), now.getTime());
}

/**
 * End-of-day snapshots, one per local calendar day.
 *
 * A season chart at per-game fidelity is unreadable — an active day holds
 * half a dozen ±20 LP swings that render as vertical noise. The daily close
 * keeps every plotted point a real observed rank (the last snapshot of the
 * day) instead of fabricating smoothed values between games. Input must be
 * time-sorted, which the backend guarantees.
 */
export function dailyClosePoints(
  points: readonly RankHistoryPointView[],
): RankHistoryPointView[] {
  const byDay = new Map<string, RankHistoryPointView>();
  for (const point of points) {
    const at = asDate(point.at);
    byDay.set(
      `${at.getFullYear().toString()}-${at.getMonth().toString()}-${at.getDate().toString()}`,
      point,
    );
  }
  return [...byDay.values()];
}

/**
 * One account's snapshots as a step line.
 *
 * Points arrive already filtered and grouped for the selected period. A
 * snapshot holds until the next observation, so the value jumps at each
 * point (`step: "end"`) instead of ramping diagonally between games the way
 * a plain connected line would.
 */
export function rankHistoryLineSeries(
  series: QueueRankHistoryView["series"][number],
) {
  return {
    name: series.accountLabel,
    type: "line" as const,
    step: "end" as const,
    showSymbol: series.points.length <= 40,
    data: series.points.map((point) => ({
      value: [asDate(point.at).getTime(), point.leaguePoints],
      rankLabel: rankToString(point.rank),
    })),
  };
}

const DAY_MS = 86_400_000;

export const RANK_HISTORY_PERIOD_ORDER = ["7d", "30d", "season"] as const;
export type RankHistoryPeriod = (typeof RANK_HISTORY_PERIOD_ORDER)[number];
export type RankHistoryGranularity = "game" | "day";

const RANK_HISTORY_PERIOD_CONFIG: Record<
  RankHistoryPeriod,
  {
    label: string;
    days: number | undefined;
    granularity: RankHistoryGranularity;
  }
> = {
  "7d": { label: "7D", days: 7, granularity: "game" },
  "30d": { label: "30D", days: 30, granularity: "day" },
  season: { label: "Season", days: undefined, granularity: "day" },
};

export function periodLabel(period: RankHistoryPeriod): string {
  return RANK_HISTORY_PERIOD_CONFIG[period].label;
}

export function periodGranularity(
  period: RankHistoryPeriod,
): RankHistoryGranularity {
  return RANK_HISTORY_PERIOD_CONFIG[period].granularity;
}

/**
 * Visible x-range for a period: the trailing window, or the whole split.
 * The start never precedes the split start, so a young season shows a
 * short window instead of empty weeks.
 */
export function periodRange(
  period: RankHistoryPeriod,
  splitStart: Date,
  splitEnd: Date,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const end = new Date(graphXAxisMax(splitEnd, now));
  const days = RANK_HISTORY_PERIOD_CONFIG[period].days;
  if (days === undefined) {
    return { start: splitStart, end };
  }
  return {
    start: new Date(
      Math.max(splitStart.getTime(), end.getTime() - days * DAY_MS),
    ),
    end,
  };
}

export function groupPointsByGranularity(
  points: readonly RankHistoryPointView[],
  granularity: RankHistoryGranularity,
): RankHistoryPointView[] {
  return granularity === "game" ? [...points] : dailyClosePoints(points);
}

export function pointsInRange(
  points: readonly RankHistoryPointView[],
  start: Date,
  end: Date,
): RankHistoryPointView[] {
  return points.filter((point) => {
    const at = asDate(point.at).getTime();
    return at >= start.getTime() && at <= end.getTime();
  });
}

/** Filter every series to the period window, then group to its granularity. */
export function preparePeriodSeries(
  series: QueueRankHistoryView["series"],
  period: RankHistoryPeriod,
  range: { start: Date; end: Date },
): QueueRankHistoryView["series"] {
  const granularity = periodGranularity(period);
  return series.map((entry) => ({
    accountLabel: entry.accountLabel,
    points: groupPointsByGranularity(
      pointsInRange(entry.points, range.start, range.end),
      granularity,
    ),
  }));
}

export function emptyRangeMessage(period: RankHistoryPeriod): string {
  const days = RANK_HISTORY_PERIOD_CONFIG[period].days;
  return days === undefined
    ? "Scout has no ranked snapshots in view for this queue."
    : `Scout recorded no ranked games in the last ${days.toString()} days.`;
}

function RankHistoryChart(props: {
  title: string;
  range: { start: Date; end: Date };
  series: QueueRankHistoryView["series"];
}) {
  const values = props.series.flatMap((series) =>
    series.points.map((point) => point.leaguePoints),
  );
  const bounds = yBounds(values);
  const showLegend = props.series.length > 1;
  const xMin = props.range.start.getTime();
  const xMax = props.range.end.getTime();
  return (
    <ProfileEchartsHost
      title={props.title}
      revision={[
        bounds.max,
        bounds.min,
        xMin,
        xMax,
        props.series,
        props.title,
        showLegend,
      ]}
      option={{
        ...profileChartChrome(props.title, { formatter: formatTooltip }),
        legend: showLegend
          ? {
              top: 34,
              textStyle: { fontFamily: VISUALIZATION_BODY_FONT },
            }
          : { show: false },
        grid: {
          top: showLegend ? 70 : 48,
          left: 72,
          right: 18,
          bottom: 36,
        },
        xAxis: {
          type: "time",
          min: xMin,
          max: xMax,
          axisLabel: {
            hideOverlap: true,
            fontFamily: VISUALIZATION_BODY_FONT,
          },
        },
        yAxis: {
          type: "value",
          min: bounds.min,
          max: bounds.max,
          axisLabel: {
            fontFamily: VISUALIZATION_BODY_FONT,
            formatter: (value: number) => leaguePointsToRankLabel(value),
          },
        },
        series: props.series.map((series) => rankHistoryLineSeries(series)),
      }}
    />
  );
}

function yBounds(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 400 };
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const min = Math.max(0, Math.floor(lo / 100) * 100 - 100);
  const max = Math.ceil(hi / 100) * 100 + 100;
  return { min, max: max <= min ? min + 100 : max };
}

const TooltipItemSchema = z.object({
  axisValue: z.union([z.number(), z.string()]).optional(),
  seriesName: z.string().optional(),
  data: z
    .object({
      rankLabel: z.string().optional(),
    })
    .optional(),
});
const TooltipItemsSchema = z.array(TooltipItemSchema);

function tooltipDate(
  axisValue: number | string | undefined,
): string | undefined {
  if (typeof axisValue === "number") {
    return new Date(axisValue).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return typeof axisValue === "string" && axisValue.length > 0
    ? axisValue
    : undefined;
}

function formatTooltip(items: unknown): string {
  const parsed = TooltipItemsSchema.safeParse(items);
  if (!parsed.success || parsed.data.length === 0) {
    return "";
  }
  const lines: string[] = [];
  for (const item of parsed.data) {
    const date = tooltipDate(item.axisValue);
    if (date !== undefined && lines.length === 0) {
      lines.push(echartsFormat.encodeHTML(date));
    }
    const rankLabel = echartsFormat.encodeHTML(item.data?.rankLabel ?? "");
    const seriesName = echartsFormat.encodeHTML(item.seriesName ?? "");
    lines.push(
      seriesName.length > 0 ? `${seriesName}: ${rankLabel}` : rankLabel,
    );
  }
  return lines.join("<br/>");
}
