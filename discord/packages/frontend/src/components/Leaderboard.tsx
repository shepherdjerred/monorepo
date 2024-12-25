import * as React from "react";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  type Leaderboard,
  type LeaderboardEntry,
  LeaderboardSchema,
  type PlayerWithSoloQueueRank,
  rankToLeaguePoints,
  rankToSimpleString,
  rankToString,
  wasDemoted,
  wasPromoted,
} from "@discord/data";
import { match, P } from "ts-pattern";
import _ from "lodash";
import { addDays, formatDistance, isWithinInterval } from "date-fns";
import { useEffect, useState } from "react";
import classnames from "classnames";
import { ChartComponent } from "./Chart";

type HistoricalLeaderboard = HistoricalLeaderboardEntry[];
type HistoricalLeaderboardEntry = {
  current: LeaderboardEntry;
  previous: LeaderboardEntry | undefined;
};

const columnHelper = createColumnHelper<HistoricalLeaderboardEntry>();

const columns = [
  columnHelper.accessor("current.position", {
    header: () => "Position",
    cell: (info) => <span className="font-bold">#{info.renderValue()}</span>,
    id: "position",
  }),
  columnHelper.accessor("current.player.config.name", {
    header: "Person",
    cell: (info) => info.getValue(),
    id: "name",
  }),
  columnHelper.accessor((row) => row, {
    header: "Change since last update",
    cell: (info) => {
      const previous = info.getValue().previous;
      if (previous === undefined) {
        return "-";
      }
      return match(info.getValue().current.leaguePoints - previous.leaguePoints)
        .with(0, () => "-")
        .with(P.number.positive(), (value) => `+${value}`)
        .with(P.number.negative(), (value) => `${value}`)
        .run();
    },
    sortingFn: (a, b) => {
      const getVal = (info: HistoricalLeaderboardEntry) => {
        const previous = info.previous;
        if (previous === undefined) {
          return -9999;
        }
        return info.current.leaguePoints - previous.leaguePoints;
      };
      return (
        getVal(a.getValue("lp-difference-since-last-update")) -
        getVal(b.getValue("lp-difference-since-last-update"))
      );
    },
    id: "lp-difference-since-last-update",
  }),
  columnHelper.accessor((row) => row.current.player.ranks.solo, {
    header: "Rank",
    cell: (info) => rankToString(info.getValue()),
    id: "rank",
    sortingFn: (a, b) =>
      rankToLeaguePoints(a.getValue("rank")) -
      rankToLeaguePoints(b.getValue("rank")),
  }),
  columnHelper.accessor((row) => row.current.player, {
    header: "Games Played",
    cell: (info) =>
      info.getValue().ranks.solo.wins + info.getValue().ranks.solo.losses,
    id: "games",
    sortingFn: (a, b) => {
      const getVal = (info: PlayerWithSoloQueueRank) => {
        return info.ranks.solo.wins + info.ranks.solo.losses;
      };
      return getVal(a.getValue("games")) - getVal(b.getValue("games"));
    },
  }),
  columnHelper.accessor((row) => row.current.player, {
    header: "Wins",
    cell: (info) => info.getValue().ranks.solo.wins,
    id: "wins",
    sortingFn: (a, b) => {
      const getVal = (info: PlayerWithSoloQueueRank) => {
        return info.ranks.solo.wins;
      };
      return getVal(a.getValue("wins")) - getVal(b.getValue("wins"));
    },
  }),
  columnHelper.accessor((row) => row.current.player, {
    header: "Losses",
    cell: (info) => info.getValue().ranks.solo.losses,
    id: "losses",
    sortingFn: (a, b) => {
      const getVal = (info: PlayerWithSoloQueueRank) => {
        return info.ranks.solo.losses;
      };
      return getVal(a.getValue("losses")) - getVal(b.getValue("losses"));
    },
  }),
  columnHelper.accessor((row) => row.current.player, {
    header: "Win Rate",
    cell: (info) => {
      const percent = _.round(
        (info.getValue().ranks.solo.wins /
          (info.getValue().ranks.solo.wins +
            info.getValue().ranks.solo.losses)) *
          100,
      );
      if (percent === 50) {
        return "INFINITY%";
      }
      return percent ? `${percent}%` : "-";
    },
    id: "win-rate",
    sortingFn: (a, b) => {
      const getVal = (info: PlayerWithSoloQueueRank) => {
        const percent = _.round(
          (info.ranks.solo.wins /
            (info.ranks.solo.wins - info.ranks.solo.losses)) *
            100,
        );
        return percent ? percent : -9999;
      };
      return getVal(a.getValue("win-rate")) - getVal(b.getValue("win-rate"));
    },
  }),
];

const now = new Date();
// TODO: this should be PST
const todayAtNoon = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
  12,
  0,
  0,
);
const tomorrowAtNoon = addDays(todayAtNoon, 1);
// 3am CT
// const end = new Date(2024, 0, 8, 12, 0, 0);

let next: Date;

if (isWithinInterval(now, { start: todayAtNoon, end: tomorrowAtNoon })) {
  next = tomorrowAtNoon;
} else {
  next = todayAtNoon;
}

function gameCount(
  leaderboard: HistoricalLeaderboardEntry,
): number | undefined {
  if (leaderboard.previous === undefined) {
    return undefined;
  }
  return (
    leaderboard.current.player.ranks.solo.wins -
    leaderboard.previous.player.ranks.solo.wins +
    (leaderboard.current.player.ranks.solo.losses -
      leaderboard.previous.player.ranks.solo.losses)
  );
}

export function LeaderboardComponent() {
  const [currentLeaderboard, setCurrentLeaderboard] = useState<
    Leaderboard | undefined
  >(undefined);
  const [leaderboard, setLeaderboard] = useState<
    HistoricalLeaderboard | undefined
  >(undefined);
  const [events, setEvents] = useState<string[]>([]);
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "position",
      desc: false,
    },
  ]);

  useEffect(() => {
    (async () => {
      let result = await fetch(
        "https://prod.bucket.discord.com/leaderboard.json",
      );
      const currentLeaderboard = LeaderboardSchema.parse(await result.json());
      setCurrentLeaderboard(currentLeaderboard);

      result = await fetch(
        "https://prod.bucket.discord.com/previous.json",
      );
      const previousJson = await result.json();
      const parseStatus = LeaderboardSchema.safeParse(previousJson);
      // TODO: handle the case where the previous leaderboard is missing
      let previousLeaderboard: Leaderboard;
      if (parseStatus.success) {
        previousLeaderboard = parseStatus.data;
      }

      const historical: HistoricalLeaderboardEntry[] = _.chain(
        currentLeaderboard.contents,
      )
        .map((entry) => {
          const player = entry.player.config.name;
          const previous = _.find(
            previousLeaderboard.contents,
            (entry) => entry.player.config.name === player,
          );
          return {
            current: entry,
            previous,
          };
        })
        .value();

      const promotions = _.flatMap(historical, (entry) => {
        if (entry.previous === undefined) {
          return [];
        }
        if (
          wasPromoted(
            entry.previous.player.ranks.solo,
            entry.current.player.ranks.solo,
          )
        ) {
          return [
            `${entry.current.player.config.name} was promoted: ${
              rankToSimpleString(
                entry.previous.player.ranks.solo,
              )
            } -> ${rankToSimpleString(entry.current.player.ranks.solo)}`,
          ];
        } else {
          return [];
        }
      });
      const demotions = _.flatMap(historical, (entry) => {
        if (entry.previous === undefined) {
          return [];
        }
        if (
          wasDemoted(
            entry.previous.player.ranks.solo,
            entry.current.player.ranks.solo,
          )
        ) {
          return [
            `${entry.current.player.config.name} was demoted: ${
              rankToSimpleString(
                entry.previous.player.ranks.solo,
              )
            } -> ${rankToSimpleString(entry.current.player.ranks.solo)}`,
          ];
        } else {
          return [];
        }
      });
      const games = _.flatMap(historical, (entry) => {
        const count = gameCount(entry);
        if (count === undefined) {
          return [];
        }
        if (count > 10) {
          return [`${entry.current.player.config.name} played ${count} games`];
        }
        return [];
      });
      setEvents([...promotions, ...demotions, ...games].sort());

      setLeaderboard(historical);
    })();
  }, []);

  const table = useReactTable<HistoricalLeaderboardEntry>({
    data: leaderboard || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSorting: true,
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  });

  return (
    <>
      <div className="flex flex-col md:flex-row">
        <div className="p-4">
          <hgroup className="">
            <h1 className="text-3xl">Tournament Leaderboard</h1>
            <p>
              Updated {currentLeaderboard?.date !== undefined
                ? formatDistance(currentLeaderboard.date, now)
                : ""} ago. Next update in{" "}
              {formatDistance(now, next)}. Competition lasts until the end of
              Season 14 Split 1.
              <br />
              Prize: $200
            </p>
          </hgroup>
          <table className="overflow-auto text-left">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="p-2 bg-gray-100 dark:bg-black"
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          {...{
                            className: header.column.getCanSort()
                              ? "cursor-pointer select-none"
                              : "",
                            onClick: header.column.getToggleSortingHandler(),
                          }}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {{
                            asc: " 🔼",
                            desc: " 🔽",
                          }[header.column.getIsSorted() as string] ?? null}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={classnames({ "p-2": true, border: true })}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4">
          <hgroup>
            <h2 className="text-3xl">Recent Events</h2>
          </hgroup>
          <ul className="list-disc list-inside">
            {events.length
              ? events.map((event) => <li key={event}>{event}</li>)
              : "No recent events."}
          </ul>
          <h3 className="text-xl">LP gains graph</h3>
          <ChartComponent />
        </div>
      </div>
    </>
  );
}
