import type { GamePageProps } from "./module.ts";
import type { Player } from "@arcade/common/catalog.ts";
import type { FightState } from "@arcade/common/telemetry.ts";
import { characterName, stageName } from "@arcade/common/metadata.ts";
import { Activity, Metric, Panel } from "#src/ui/panels.tsx";

function Arena({
  room,
  stats,
  brawl,
}: GamePageProps & { readonly brawl: boolean }) {
  const state = room.state?.family === "fighting" ? room.state : null;
  const gameId = brawl ? "brawl" : "melee";
  return (
    <div className={`game-panels ${brawl ? "brawl-layout" : "melee-layout"}`}>
      <Panel
        title={brawl ? "Ready to brawl" : "The arena"}
        aside={
          <span className="tag">
            {state?.phase ?? "WAITING FOR CHALLENGERS"}
          </span>
        }
      >
        <FightSummary state={state} gameId={gameId} />
        <div className="fighter-cards">
          {room.seats.map((player, seat) => (
            <FighterCard
              key={seat}
              player={player}
              seat={seat}
              gameId={gameId}
              fighter={state?.fighters.find((entry) => entry.seat === seat)}
              showStocks={
                state?.mode === "stock" || state?.phase === "sudden-death"
              }
            />
          ))}
        </div>
        {state?.teams === true || state?.mode === "other" ? (
          <p className="notice">
            This mode is playable. Detailed records cover stock and timed
            free-for-all matches.
          </p>
        ) : null}
      </Panel>
      <FightRecords stats={stats} brawl={brawl} />
      <Activity events={room.events} />
    </div>
  );
}

export function MeleePage(props: GamePageProps) {
  return <Arena {...props} brawl={false} />;
}
export function BrawlPage(props: GamePageProps) {
  return <Arena {...props} brawl />;
}

function FighterCard({
  player,
  seat,
  gameId,
  fighter,
  showStocks,
}: {
  readonly player: Player | null;
  readonly seat: number;
  readonly gameId: "melee" | "brawl";
  readonly fighter: FightState["fighters"][number] | undefined;
  readonly showStocks: boolean;
}) {
  const damage = fighter?.damage ?? null;
  return (
    <div className={`fighter-card player-${String(seat)}`}>
      <div className="fighter-number">P{seat + 1}</div>
      <h3>{player?.name ?? "Join the battle"}</h3>
      <p>
        {fighter !== undefined && characterName(gameId, fighter.characterId)}
      </p>
      <strong
        className="damage"
        style={{
          color: damage !== null && damage > 100 ? "#ff7065" : undefined,
        }}
      >
        {damage === null ? "—" : Math.floor(damage)}
        <small>%</small>
      </strong>
      <p>
        {showStocks
          ? `${String(fighter?.stocks ?? "—")} STOCKS`
          : `SCORE ${String(fighter?.score ?? "—")}`}
      </p>
      <span className="eyebrow">
        KOs {fighter?.kos ?? "—"} · FALLS {fighter?.falls ?? "—"}
      </span>
      {fighter?.winner === true && <span className="tag">WINNER</span>}
    </div>
  );
}

function FightSummary({
  state,
  gameId,
}: {
  readonly state: FightState | null;
  readonly gameId: "melee" | "brawl";
}) {
  const remainingMs = state?.remainingMs ?? null;
  const stageId = state?.stageId ?? null;
  return (
    <div className="arena-summary">
      <span>
        {state?.mode === "stock"
          ? "STOCK BATTLE"
          : state?.mode === "time"
            ? "TIMED BATTLE"
            : "FREE-FOR-ALL"}
      </span>
      <strong>
        {remainingMs === null
          ? "— : —"
          : `${String(Math.floor(remainingMs / 60_000))}:${String(Math.floor(remainingMs / 1000) % 60).padStart(2, "0")}`}
      </strong>
      <span>{stageId === null ? "STAGE —" : stageName(gameId, stageId)}</span>
    </div>
  );
}
function FightRecords({
  stats,
  brawl,
}: Pick<GamePageProps, "stats"> & { readonly brawl: boolean }) {
  return (
    <Panel title={brawl ? "Brawl chronicles" : "Versus records"}>
      <div className="metrics">
        <Metric label="Challengers" value={stats?.leaderboard.length ?? "—"} />
        <Metric
          label="KOs"
          value={
            stats?.leaderboard.reduce(
              (sum, player) => sum + (player.kos ?? 0),
              0,
            ) ?? "—"
          }
        />
        <Metric
          label="Self-destructs"
          value={
            stats?.leaderboard.reduce(
              (sum, player) => sum + (player.selfDestructs ?? 0),
              0,
            ) ?? "—"
          }
        />
      </div>
    </Panel>
  );
}
