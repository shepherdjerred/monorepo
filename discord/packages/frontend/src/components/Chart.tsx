import * as React from "react";

import {
  convertOldLeaderboard,
  type Leaderboard,
  type LeaderboardEntry,
  LeaderboardSchema,
  OldLeaderboardSchema,
} from "@discord/data";
import _ from "lodash";
import { useEffect, useState } from "react";
import { type D3Scale, type ScaleInput, scaleTime } from "@visx/scale";
import * as allCurves from "@visx/curve";
import { Group } from "@visx/group";
import { LinePath } from "@visx/shape";
import { extent } from "d3-array";
import { timeFormat } from "d3-time-format";
import { Axis, Orientation } from "@visx/axis";
import { coerceNumber, scaleLinear, scaleUtc } from "@visx/scale";

const width = 300;
const svgHeight = 300;
const scaleHeight = svgHeight - 30;
const lineHeight = svgHeight / 1;

export const backgroundColor = "#da7cff";
const axisColor = "#000";
export const labelColor = "#340098";
const tickLabelProps = {
  fill: "#000",
  fontSize: 12,
  fontFamily: "sans-serif",
  textAnchor: "middle",
} as const;

const getMinMax = (vals: (number | { valueOf(): number })[]) => {
  const numericVals = vals.map(coerceNumber);
  return [Math.min(...numericVals), Math.max(...numericVals)];
};

export function ChartComponent() {
  const [leaderboards, setLeaderboards] = useState<Leaderboard[]>([]);

  const firstDay = new Date("2024-01-10");
  const dates: string[] = [];
  // add all days between firstDay and today to dates
  for (let d = firstDay; d <= new Date(); d.setDate(d.getDate() + 1)) {
    // skip today
    // issue with timezones
    if (
      d.toISOString().split("T")[0] === new Date().toISOString().split("T")[0]
    ) {
      continue;
    }

    // skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) {
      continue;
    }
    // convert the date to a string in the format "YYYY-MM-DD"
    const str = d.toISOString().split("T")[0];

    // skip 2024-01-13
    // skip 2024-01-20
    // skip 2024-01-27

    if (d.toISOString().split("T")[0] === "2024-01-13") {
      continue;
    }
    if (d.toISOString().split("T")[0] === "2024-01-20") {
      continue;
    }
    if (d.toISOString().split("T")[0] === "2024-01-27") {
      continue;
    }

    if (str !== undefined) {
      dates.push(str);
    } else {
      console.error("date string is undefined");
    }
  }

  useEffect(() => {
    (async () => {
      const leaderboards = await Promise.all(
        _.map(dates, async (date): Promise<Leaderboard | undefined> => {
          try {
            const json = await (await fetch(
              `https://prod.bucket.discord.com/leaderboards/${date}.json`,
            )).json();
            const result = LeaderboardSchema.safeParse(json);
            if (result.success) {
              return result.data;
            } else {
              // try old leaderboard
              const result = OldLeaderboardSchema.safeParse(json);
              if (result.success) {
                return convertOldLeaderboard(result.data);
              } else {
                return undefined;
              }
            }
          } catch (e) {
            console.error(`failed to fetch leaderboard for date: ${date}`);
            return undefined;
          }
        }),
      );

      setLeaderboards(
        leaderboards.filter((x): x is Leaderboard => x !== undefined),
      );
    })();
  }, []);

  type ChartEntry = {
    date: Date;
    content: LeaderboardEntry;
  };

  const grouped: Record<string, ChartEntry[]> = _.chain(leaderboards)
    .flatMap((leaderboard) => {
      return _.map(leaderboard.contents, (content): ChartEntry => {
        return {
          date: leaderboard.date,
          content,
        };
      });
    })
    .groupBy((leaderboard) => leaderboard.content.player.config.name)
    .value();

  const allData: ChartEntry[] = _.chain(grouped).values().flatMap().value();

  const getX = (d: ChartEntry): Date => d.date;
  const getY = (d: ChartEntry): number => d.content.leaguePoints;

  const xScale = scaleTime<number>({
    domain: extent(allData, getX) as [Date, Date],
  });
  const yScale = scaleLinear<number>({
    domain: extent(allData, getY) as [number, number],
  });

  xScale.range([0, width]);
  yScale.range([lineHeight - 2, 0]);

  const xAxis = {
    scale: scaleUtc({
      domain: getMinMax(_.map(allData, getX)),
      range: [0, width],
    }),
    values: _.chain(allData).map(getX).uniq().value(),
    tickFormat: (v: ScaleInput<D3Scale<Date>>, i: number) =>
      // TODO: remove this assertion
      width > 400 || i % 2 === 0 ? timeFormat("%b %d")(v as Date) : "",
    label: "time",
  };

  return (
    <>
      <svg width={width} height={svgHeight}>
        <rect width={width} height={svgHeight} fill="#efefef" />
        {_.map(grouped, (entries, name) => {
          return (
            <Group key={name}>
              <LinePath
                curve={allCurves.curveBasis}
                data={entries}
                stroke="#333"
                strokeWidth={2}
                markerMid="url(#marker-arrow)"
                x={(d) => xScale(getX(d))}
                y={(d) => yScale(getY(d))}
              />
            </Group>
          );
        })}
        <Axis
          orientation={Orientation.bottom}
          top={scaleHeight}
          scale={xAxis.scale}
          stroke={axisColor}
          tickStroke={axisColor}
          tickLabelProps={tickLabelProps}
          tickValues={xAxis.values}
          tickFormat={xAxis.tickFormat}
          numTicks={1}
          label={""}
          labelProps={{
            x: 0,
            y: 0,
            fill: labelColor,
            fontSize: 18,
            strokeWidth: 1,
            stroke: "#000",
            paintOrder: "stroke",
            fontFamily: "sans-serif",
            textAnchor: "start",
          }}
        />
      </svg>
    </>
  );
}
