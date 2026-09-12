import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  VISUALIZATION_BODY_FONT,
  VISUALIZATION_DISPLAY_FONT,
} from "@scout-for-lol/report/browser";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

type ChartPoint =
  RouterOutputs["consumerMatch"]["chartSeries"]["points"][number];

export function hasSelectedPlayerProgression(
  points: { selectedGold: number | null; selectedXp: number | null }[],
): boolean {
  return points.some(
    (point) => point.selectedGold !== null || point.selectedXp !== null,
  );
}

export function TimelineCharts(props: { points: ChartPoint[] }) {
  const teamIds = [
    ...new Set(
      props.points.flatMap((point) =>
        point.teamGold.map((team) => team.teamId),
      ),
    ),
  ];
  const timeLabels = props.points.map((point) =>
    Math.round(point.timestampMs / 60_000),
  );
  const teamSeries = teamIds.map((teamId) => ({
    name: `Team ${teamId.toString()}`,
    type: "line" as const,
    showSymbol: false,
    data: props.points.map(
      (point) =>
        point.teamGold.find((team) => team.teamId === teamId)?.gold ?? null,
    ),
  }));
  const playerSeries = [
    {
      name: "Gold",
      type: "line" as const,
      showSymbol: false,
      data: props.points.map((point) => point.selectedGold),
    },
    {
      name: "XP",
      type: "line" as const,
      showSymbol: false,
      data: props.points.map((point) => point.selectedXp),
    },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TimelineChart
        title="Team gold"
        labels={timeLabels}
        series={teamSeries}
      />
      {hasSelectedPlayerProgression(props.points) ? (
        <TimelineChart
          title="Selected-player progression"
          labels={timeLabels}
          series={playerSeries}
        />
      ) : null}
    </div>
  );
}

function TimelineChart(props: {
  title: string;
  labels: number[];
  series: {
    name: string;
    type: "line";
    showSymbol: boolean;
    data: (number | null)[];
  }[];
}) {
  const container = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (container.current === null) return;
    const chart = echarts.init(container.current);
    chart.setOption({
      textStyle: { fontFamily: VISUALIZATION_BODY_FONT },
      title: {
        text: props.title,
        left: 12,
        top: 8,
        textStyle: {
          fontSize: 14,
          fontFamily: VISUALIZATION_DISPLAY_FONT,
          fontWeight: 700,
        },
      },
      tooltip: {
        trigger: "axis",
        textStyle: { fontFamily: VISUALIZATION_BODY_FONT },
      },
      legend: {
        top: 34,
        textStyle: { fontFamily: VISUALIZATION_BODY_FONT },
      },
      grid: { top: 70, left: 52, right: 18, bottom: 36 },
      xAxis: {
        type: "category",
        name: "min",
        data: props.labels,
        nameTextStyle: { fontFamily: VISUALIZATION_BODY_FONT },
        axisLabel: { fontFamily: VISUALIZATION_BODY_FONT },
      },
      yAxis: {
        type: "value",
        axisLabel: { fontFamily: VISUALIZATION_BODY_FONT },
      },
      series: props.series,
    });
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [props.labels, props.series, props.title]);
  return (
    <div
      ref={container}
      className="h-72 rounded-md border bg-card"
      role="img"
      aria-label={props.title}
    />
  );
}
