import { format as echartsFormat } from "echarts";
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
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Ranked history</h2>
        <p className="text-sm text-scout-subtle">
          Live post-match snapshots Scout recorded for{" "}
          {history.currentSplit.displayName}. This is not a Riot career graph,
          and it does not change with the game filters below.
        </p>
      </div>
      <Tabs defaultValue="solo">
        <TabsList aria-label="Ranked queues">
          {QUEUE_TABS.map((tab) => (
            <TabsTrigger key={tab.queue} value={tab.queue}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {QUEUE_TABS.map((tab) => (
          <TabsContent key={tab.queue} value={tab.queue} className="space-y-4">
            <QueueRankHistory
              queueLabel={tab.label}
              splitName={history.currentSplit.displayName}
              start={asDate(history.currentSplit.start)}
              end={asDate(history.currentSplit.end)}
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
  queue: QueueRankHistoryView;
}) {
  const hasCurrent = queueHasCurrentPoints(props.queue);
  return (
    <>
      {hasCurrent ? (
        <RankHistoryChart
          title={`${props.queueLabel} · ${props.splitName}`}
          start={props.start}
          end={props.end}
          series={props.queue.series}
        />
      ) : (
        <p className="text-sm text-scout-subtle">
          Scout has no ranked snapshots for this queue in {props.splitName}.
          Rank history starts when Scout processes a live ranked game.
        </p>
      )}
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

function RankHistoryChart(props: {
  title: string;
  start: Date;
  end: Date;
  series: QueueRankHistoryView["series"];
}) {
  const values = props.series.flatMap((series) =>
    series.points.map((point) => point.leaguePoints),
  );
  const bounds = yBounds(values);
  const showLegend = props.series.length > 1;
  return (
    <ProfileEchartsHost
      title={props.title}
      revision={[
        bounds.max,
        bounds.min,
        props.end,
        props.series,
        props.start,
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
          min: props.start.getTime(),
          max: props.end.getTime(),
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
        series: props.series.map((series) => ({
          name: series.accountLabel,
          type: "line" as const,
          showSymbol: series.points.length <= 40,
          data: series.points.map((point) => ({
            value: [asDate(point.at).getTime(), point.leaguePoints],
            rankLabel: rankToString(point.rank),
          })),
        })),
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
