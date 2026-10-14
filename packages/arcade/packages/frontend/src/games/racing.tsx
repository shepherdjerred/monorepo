import type { GamePageProps } from "./module.ts";
import type { Player } from "@arcade/common/catalog.ts";
import type { RaceState } from "@arcade/common/telemetry.ts";
import {
  characterName,
  courseName,
  vehicleName,
} from "@arcade/common/metadata.ts";
import { Activity, Metric, Panel, duration } from "#src/ui/panels.tsx";

function RaceDashboard({
  room,
  stats,
  modern,
}: GamePageProps & { readonly modern: boolean }) {
  const state = room.state?.family === "racing" ? room.state : null;
  const gameId = modern ? "mkwii" : "mk64";
  return (
    <div className={`game-panels ${modern ? "wii-layout" : "mk64-layout"}`}>
      <Panel
        title={modern ? "Race control" : "On the starting grid"}
        aside={
          <span className="tag">{state?.phase ?? "WAITING FOR RACERS"}</span>
        }
      >
        <RaceSummary state={state} gameId={gameId} />
        <div className="racer-cards">
          {room.seats.map((player, seat) => (
            <RacerCard
              key={seat}
              player={player}
              seat={seat}
              gameId={gameId}
              racer={state?.racers.find((entry) => entry.seat === seat)}
              lapCount={state?.lapCount ?? null}
            />
          ))}
        </div>
      </Panel>
      {modern && state !== null && <RaceField room={room} state={state} />}
      <Activity events={room.events} />
      <RaceRecords stats={stats} modern={modern} />
    </div>
  );
}

export function Mk64Page(props: GamePageProps) {
  return <RaceDashboard {...props} modern={false} />;
}
export function WiiPage(props: GamePageProps) {
  return <RaceDashboard {...props} modern />;
}

function RacerCard({
  player,
  seat,
  gameId,
  racer,
  lapCount,
}: {
  readonly player: Player | null;
  readonly seat: number;
  readonly gameId: "mk64" | "mkwii";
  readonly racer: RaceState["racers"][number] | undefined;
  readonly lapCount: number | null;
}) {
  return (
    <div className={`racer-card player-${String(seat)}`}>
      <span className="eyebrow">PLAYER {seat + 1}</span>
      <h3>{player?.name ?? "Open seat"}</h3>
      <p>
        {racer !== undefined && characterName(gameId, racer.characterId)}
        {racer?.vehicleId !== undefined &&
          racer.vehicleId !== null &&
          ` · ${vehicleName(racer.vehicleId)}`}
      </p>
      <strong className="placement">
        {racer?.placement ?? "—"}
        <small>PLACE</small>
      </strong>
      <p>{lapLabel(racer, lapCount)}</p>
      <span className="mono">{duration(racer?.timeMs ?? null)}</span>
    </div>
  );
}

function lapLabel(
  racer: RaceState["racers"][number] | undefined,
  lapCount: number | null,
): string {
  if (racer === undefined) return "Ready when you are";
  if (racer.finished) return "Finished";
  if (racer.lap === null) return "Lap —";
  return `Lap ${String(racer.lap)}${lapCount === null ? "" : ` / ${String(lapCount)}`}`;
}

function RaceSummary({
  state,
  gameId,
}: {
  readonly state: RaceState | null;
  readonly gameId: "mk64" | "mkwii";
}) {
  const courseId = state?.courseId ?? null;
  return (
    <div className="metrics">
      <Metric
        label="Course"
        value={courseId === null ? "—" : courseName(gameId, courseId)}
      />
      <Metric label="Race format" value={state?.mode ?? "—"} />
      <Metric label="Class" value={state?.engineClass ?? "—"} />
    </div>
  );
}
function RaceRecords({
  stats,
  modern,
}: Pick<GamePageProps, "stats"> & { readonly modern: boolean }) {
  return (
    <Panel title={modern ? "Trackside records" : "Hall of fame"}>
      <div className="metrics">
        <Metric label="Recorded races" value={stats?.totalRounds ?? "—"} />
        <Metric label="Drivers" value={stats?.leaderboard.length ?? "—"} />
        <Metric label="Course records" value={stats?.records.length ?? "—"} />
      </div>
    </Panel>
  );
}
function RaceField({
  room,
  state,
}: Pick<GamePageProps, "room"> & { readonly state: RaceState }) {
  return (
    <Panel title="The field" aside={<span>{state.racers.length} racers</span>}>
      <div className="field">
        {state.racers
          .toSorted((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
          .map((racer) => (
            <div key={racer.slot}>
              <strong>{racer.placement ?? "—"}</strong>
              <span>
                {racer.seat === null
                  ? "CPU"
                  : (room.seats[racer.seat]?.name ?? "Unclaimed controller")}
              </span>
              <span>{duration(racer.timeMs)}</span>
            </div>
          ))}
      </div>
    </Panel>
  );
}
