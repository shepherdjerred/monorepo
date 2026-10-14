import { z } from "zod";
import { FightStateSchema, type FightState } from "@arcade/common/telemetry.ts";

const integer = z.number().int();
const counter = integer.min(0);
export const MeleeProbeSchema = z.strictObject({
  version: z.literal(1),
  frame: counter,
  scene: counter,
  majorMode: counter,
  prepared: z.boolean(),
  aborted: z.boolean(),
  matchKind: integer.min(-1).max(3),
  teams: z.boolean(),
  stageId: counter.nullable(),
  remainingMs: counter.nullable(),
  players: z
    .array(
      z.strictObject({
        slot: integer.min(0).max(3),
        port: integer.min(0).max(3),
        type: z.literal([0, 1, 2]),
        characterId: integer.min(0).max(32),
        damage: counter,
        stocks: integer.min(-1).max(99),
        kos: counter,
        falls: counter,
        selfDestructs: counter,
        score: integer.nullable(),
        placement: integer.min(1).max(4).nullable(),
      }),
    )
    .max(4),
});
type Probe = z.infer<typeof MeleeProbeSchema>;
type Original = Pick<
  Probe["players"][number],
  "slot" | "port" | "type" | "characterId"
>;

/** Match identity survives shader preparation, transformed fighters and sudden death. */
export class MeleeTelemetry {
  private round = 0;
  private previousScene = 0;
  private active:
    | {
        mode: FightState["mode"];
        teams: boolean;
        stageId: number;
        players: Original[];
      }
    | undefined;

  observe(message: unknown): FightState {
    const probe = MeleeProbeSchema.parse(message);
    const previousScene = this.previousScene;
    this.previousScene = probe.scene;
    if (previousScene === 5 && probe.scene === 2) this.active = undefined;
    if (
      probe.majorMode !== 2 ||
      ![2, 3, 5].includes(probe.scene) ||
      probe.aborted
    ) {
      this.active = undefined;
      return this.empty("menu");
    }
    if (probe.scene === 2 && probe.prepared && this.active === undefined) {
      this.begin(probe);
    }
    const active = this.active;
    if (active === undefined) return this.empty("loading");
    const phase =
      probe.scene === 5
        ? "results"
        : probe.scene === 3
          ? "sudden-death"
          : "playing";
    return FightStateSchema.parse({
      family: "fighting",
      phase,
      round: this.round,
      mode: active.mode,
      teams: active.teams,
      stageId: active.stageId,
      remainingMs: probe.scene === 3 ? 0 : probe.remainingMs,
      fighters: active.players.map((original) => {
        const current = probe.players.find(
          (player) => player.slot === original.slot,
        );
        const placement =
          phase === "results" ? (current?.placement ?? null) : null;
        if (phase === "results" && placement === null)
          throw new Error("Melee results omitted an original fighter");
        return {
          seat: original.type === 0 ? original.port : original.slot,
          human: original.type === 0,
          characterId: original.characterId,
          ...fighterMetrics(current),
          stocks:
            active.mode === "stock" || probe.scene === 3
              ? Math.max(0, current?.stocks ?? 0)
              : null,
          placement,
          winner: placement === null ? null : placement === 1,
        };
      }),
    });
  }

  private begin(probe: Probe): void {
    if (probe.stageId === null)
      throw new Error("Melee started without a stage");
    this.round++;
    this.active = {
      mode:
        probe.matchKind === 0
          ? "time"
          : probe.matchKind === 1
            ? "stock"
            : "other",
      teams: probe.teams,
      stageId: probe.stageId,
      players: probe.players.map(({ slot, port, type, characterId }) => ({
        slot,
        port,
        type,
        characterId,
      })),
    };
  }

  private empty(phase: "menu" | "loading"): FightState {
    return {
      family: "fighting",
      phase,
      round: this.round,
      mode: "other",
      teams: false,
      stageId: null,
      remainingMs: null,
      fighters: [],
    };
  }
}

function fighterMetrics(current: Probe["players"][number] | undefined) {
  return {
    damage: current?.damage ?? null,
    score: current?.score ?? null,
    kos: current?.kos ?? null,
    falls: current?.falls ?? null,
    selfDestructs: current?.selfDestructs ?? null,
  };
}
