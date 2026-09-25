import { useState } from "react";
import { Link } from "react-router";
import { championNameToDisplayName } from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { ChampionIcon } from "#src/components/match/champion-icon.tsx";
import {
  formatPercent,
  formatPosition,
} from "#src/components/player/player-profile-sections.tsx";

export type ChampionRow = {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  losses?: number | undefined;
  winRate: number;
  kda: number;
  averageKills?: number | undefined;
  averageDeaths?: number | undefined;
  averageAssists?: number | undefined;
  averageCs?: number | undefined;
  csPerMinute: number;
  damagePerMinute?: number | undefined;
  averageDamage?: number | undefined;
  averageVisionScore?: number | undefined;
  teamPosition?: string | null | undefined;
  lowSample: boolean;
};

export function ChampionPoolTable(props: {
  rows: ChampionRow[];
  minGamesForRate: number;
  profileSearch: string;
}) {
  const [page, setPage] = useState(0);
  if (props.rows.length === 0) {
    return (
      <p className="p-4 text-sm text-scout-subtle">
        No games in Scout&apos;s history for this player yet.
      </p>
    );
  }

  const totalPages = Math.ceil(props.rows.length / 10);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Champion</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="text-right">KDA</TableHead>
            <TableHead className="text-right">CS</TableHead>
            <TableHead className="text-right">Damage</TableHead>
            <TableHead className="text-right">Vision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.slice(page * 10, page * 10 + 10).map((row) => {
            const losses = row.losses ?? Math.max(0, row.games - row.wins);
            const pos = row.teamPosition?.trim().toUpperCase();
            const hasPosition =
              pos !== undefined && pos.length > 0 && pos !== "INVALID";
            return (
              <TableRow key={row.championId}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <ChampionIcon championName={row.championName} decorative />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          to={`/champions/${row.championId.toString()}${props.profileSearch}`}
                        >
                          {championNameToDisplayName(row.championName)}
                        </Link>
                        {hasPosition && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 font-normal leading-tight"
                          >
                            {formatPosition(row.teamPosition ?? "")}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.games.toString()}{" "}
                        {row.games === 1 ? "game" : "games"}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-medium">
                    {row.lowSample ? (
                      <span className="text-muted-foreground">
                        {formatPercent(row.winRate)}*
                      </span>
                    ) : (
                      formatPercent(row.winRate)
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.wins}W {losses}L
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-medium">{row.kda.toFixed(2)}</div>
                  {row.averageKills === undefined ? null : (
                    <div className="text-xs text-muted-foreground">
                      {row.averageKills.toFixed(1)} /{" "}
                      {row.averageDeaths?.toFixed(1)} /{" "}
                      {row.averageAssists?.toFixed(1)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-medium">
                    {row.csPerMinute.toFixed(1)}/m
                  </div>
                  {row.averageCs === undefined ? null : (
                    <div className="text-xs text-muted-foreground">
                      {Math.round(row.averageCs)} avg
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.damagePerMinute === undefined ||
                  row.damagePerMinute <= 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      <div className="font-medium">
                        {Math.round(row.damagePerMinute).toLocaleString()}/m
                      </div>
                      {row.averageDamage === undefined ? null : (
                        <div className="text-xs text-muted-foreground">
                          {Math.round(row.averageDamage).toLocaleString()} avg
                        </div>
                      )}
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.averageVisionScore === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="font-medium">
                      {row.averageVisionScore.toFixed(1)}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {(props.rows.length > 10 || props.rows.some((row) => row.lowSample)) && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between bg-muted/20">
          <div className="text-xs text-muted-foreground">
            {props.rows.length > 10 && (
              <span>
                Page {(page + 1).toString()} of {totalPages.toString()}
              </span>
            )}
            {props.rows.some((row) => row.lowSample) && (
              <span
                className={
                  props.rows.length > 10
                    ? "ml-3 border-l border-border pl-3"
                    : ""
                }
              >
                * Fewer than {props.minGamesForRate.toString()} games —
                indicative rate
              </span>
            )}
          </div>
          {props.rows.length > 10 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => {
                  setPage((current) => current - 1);
                }}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={(page + 1) * 10 >= props.rows.length}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
