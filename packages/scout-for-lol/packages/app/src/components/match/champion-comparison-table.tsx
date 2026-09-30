import { Link } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";

export type ChampionComparisonRow = {
  playerId: number;
  alias: string;
  guild: { guildId: string; name: string };
  viewerLinked: boolean;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  kda: number;
  csPerMinute: number;
  damagePerMinute: number;
  goldPerMinute: number;
  visionPerMinute: number;
};

function rate(value: number): string {
  return `${Math.round(value * 100).toString()}%`;
}

export function ChampionComparisonTable(props: {
  rows: ChampionComparisonRow[];
  profileSearch: string;
  page: number;
  hasNextPage: boolean;
  pending: boolean;
  empty: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (!props.pending && props.rows.length === 0) {
    return <p className="text-sm text-scout-subtle">{props.empty}</p>;
  }
  return (
    <div className="space-y-3 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Guild</TableHead>
            <TableHead className="text-right">W-L</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="text-right">KDA</TableHead>
            <TableHead className="text-right">CS/min</TableHead>
            <TableHead className="text-right">Damage/min</TableHead>
            <TableHead className="text-right">Gold/min</TableHead>
            <TableHead className="text-right">Vision/min</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <TableRow
              key={`${row.guild.guildId}:${row.playerId.toString()}`}
              className={row.viewerLinked ? "bg-primary/10" : undefined}
            >
              <TableCell className="font-medium">
                <Link
                  className="underline-offset-4 hover:underline"
                  to={`/players/${row.playerId.toString()}${props.profileSearch}`}
                >
                  {row.alias}
                </Link>
                {row.viewerLinked && (
                  <span className="ml-2 text-xs text-primary">You</span>
                )}
              </TableCell>
              <TableCell>{row.guild.name}</TableCell>
              <TableCell className="text-right">
                {row.wins.toString()}-{row.losses.toString()}
              </TableCell>
              <TableCell className="text-right">{rate(row.winRate)}</TableCell>
              <TableCell className="text-right">{row.kda.toFixed(2)}</TableCell>
              <TableCell className="text-right">
                {row.csPerMinute.toFixed(1)}
              </TableCell>
              <TableCell className="text-right">
                {row.damagePerMinute.toFixed(0)}
              </TableCell>
              <TableCell className="text-right">
                {row.goldPerMinute.toFixed(0)}
              </TableCell>
              <TableCell className="text-right">
                {row.visionPerMinute.toFixed(1)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-scout-subtle">
          Page {(props.page + 1).toString()}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.page === 0 || props.pending}
            onClick={props.onPrevious}
          >
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!props.hasNextPage || props.pending}
            onClick={props.onNext}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
