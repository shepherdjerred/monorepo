import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import {
  TimelinePagination,
  type TimelineCursor,
} from "#src/components/timeline-pagination.tsx";
import type { RouterOutputs } from "#src/lib/trpc.ts";

type TimelineFrame = RouterOutputs["consumerMatch"]["frames"]["rows"][number];

export const FRAME_COLUMNS: readonly (keyof TimelineFrame)[] = [
  "frame_index",
  "frame_timestamp_ms",
  "participant_id",
  "puuid",
  "position_x",
  "position_y",
  "current_gold",
  "total_gold",
  "gold_per_second",
  "minions_killed",
  "jungle_minions_killed",
  "level",
  "xp",
  "time_enemy_spent_controlled",
  "ability_haste",
  "ability_power",
  "armor",
  "attack_damage",
  "attack_speed",
  "health",
  "health_max",
  "magic_resist",
  "movement_speed",
  "power",
  "power_max",
  "total_damage_done",
  "total_damage_done_to_champions",
  "total_damage_taken",
];

function displayCell(value: TimelineFrame[keyof TimelineFrame]): string {
  return value === null ? "—" : String(value);
}

export function TimelineFrameTable(props: {
  rows: TimelineFrame[];
  error: boolean;
  pending: boolean;
  page: number;
  nextCursor: TimelineCursor | null | undefined;
  onPrevious: () => void;
  onNext: (cursor: TimelineCursor) => void;
}) {
  if (props.error) {
    return <p className="text-sm text-scout-danger">Frames did not load.</p>;
  }
  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {FRAME_COLUMNS.map((column) => (
                <TableHead key={column}>
                  {column.replaceAll("_", " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.map((frame) => (
              <TableRow
                key={`${frame.frame_index.toString()}:${frame.participant_id.toString()}`}
              >
                {FRAME_COLUMNS.map((column) => (
                  <TableCell key={column}>
                    {displayCell(frame[column])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TimelinePagination
        page={props.page}
        pending={props.pending}
        nextCursor={props.nextCursor}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
      />
    </>
  );
}
