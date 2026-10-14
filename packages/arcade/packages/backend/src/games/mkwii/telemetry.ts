import { z } from "zod";
import { RaceStateSchema, type RaceState } from "@arcade/common/telemetry.ts";

const counter = z.number().int().nonnegative();
export const MkwProbeSchema = z.strictObject({
  version: z.literal(1),
  frame: counter,
  instance: counter,
  stage: counter.max(4).nullable(),
  camera: counter.max(12),
  mode: counter.max(12),
  courseId: counter.nullable(),
  engineClass: counter.max(3).nullable(),
  mirror: z.boolean(),
  lapCount: counter.max(99).nullable(),
  players: z
    .array(
      z.strictObject({
        slot: counter.max(11),
        port: z.number().int().min(-1).max(3),
        type: counter.max(5),
        characterId: counter.max(47),
        vehicleId: counter.max(35),
        lap: counter.max(99),
        placement: counter.max(12),
        finished: z.boolean(),
        timeMs: counter.nullable(),
      }),
    )
    .max(12),
});
type Probe = z.infer<typeof MkwProbeSchema>;

export class MkwTelemetry {
  private round = 0;
  private original: RaceState | undefined;
  private instance = 0;

  observe(message: unknown): RaceState {
    const probe = MkwProbeSchema.parse(message);
    if (
      probe.stage === null ||
      probe.mode > 3 ||
      [1, 2, 3, 4, 6].includes(probe.camera)
    ) {
      this.original = undefined;
      return this.empty("menu");
    }
    if (probe.instance !== this.instance || probe.stage < 2)
      this.original = undefined;
    this.instance = probe.instance;
    if (probe.stage < 2) return this.empty("staging");
    if (this.original === undefined && probe.stage === 2) this.begin(probe);
    const original = this.original;
    if (original === undefined) return this.empty("menu");
    original.phase = probe.stage >= 3 ? "finished" : "racing";
    for (const racer of original.racers) {
      // Once a human finishes, CPUs may keep racing and alter the live position.
      if (racer.finished) continue;
      const current = probe.players.find(
        (player) => player.slot === racer.slot,
      );
      if (current === undefined)
        throw new Error("MKW race omitted an original player");
      racer.lap = current.lap;
      racer.placement = current.placement === 0 ? null : current.placement;
      racer.timeMs = current.timeMs;
      racer.finished = current.finished;
    }
    return RaceStateSchema.parse(original);
  }

  private begin(probe: Probe): void {
    this.round++;
    const modes: Readonly<Record<number, RaceState["mode"]>> = {
      0: "gp",
      1: "versus",
      2: "time-trials",
      3: "battle",
    };
    const mode = modes[probe.mode];
    if (mode === undefined) throw new Error("Unsupported MKW race mode");
    const classes = ["50cc", "100cc", "150cc", "Battle"];
    this.original = RaceStateSchema.parse({
      family: "racing",
      phase: "racing",
      round: this.round,
      mode,
      courseId: probe.courseId,
      engineClass:
        probe.engineClass === null ? null : classes[probe.engineClass],
      mirror: probe.mirror,
      lapCount: probe.lapCount,
      racers: probe.players
        .filter((player) => player.type === 0 || player.type === 1)
        .map((player) => ({
          slot: player.slot,
          seat: player.type === 0 && player.port >= 0 ? player.port : null,
          human: player.type === 0,
          characterId: player.characterId,
          vehicleId: player.vehicleId,
          lap: player.lap,
          placement: player.placement === 0 ? null : player.placement,
          timeMs: player.timeMs,
          finished: player.finished,
        })),
    });
    for (const racer of this.original.racers)
      if (racer.human && racer.seat === null)
        throw new Error("MKW human has no controller port");
  }

  private empty(phase: "menu" | "staging"): RaceState {
    return {
      family: "racing",
      phase,
      round: this.round,
      mode: "versus",
      courseId: null,
      engineClass: null,
      mirror: null,
      lapCount: null,
      racers: [],
    };
  }
}
