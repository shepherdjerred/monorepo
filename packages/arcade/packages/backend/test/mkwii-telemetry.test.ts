import { describe, expect, it } from "vitest";
import { MkwProbeSchema, MkwTelemetry } from "#src/games/mkwii/telemetry.ts";

function probe() {
  return MkwProbeSchema.parse({
    version: 1,
    frame: 1,
    instance: 100,
    stage: 2,
    camera: 0,
    mode: 1,
    courseId: 8,
    engineClass: 1,
    mirror: true,
    lapCount: 3,
    players: Array.from({ length: 5 }, (_unused, slot) => ({
      slot,
      port: slot < 4 ? slot : -1,
      type: slot < 4 ? 0 : 1,
      characterId: slot,
      vehicleId: slot,
      lap: 1,
      placement: slot + 1,
      finished: false,
      timeMs: 1000,
    })),
  });
}

describe("MKW authoritative race state", () => {
  it("ignores the title's attract-mode races", () => {
    const reader = new MkwTelemetry();
    const raw = probe();
    raw.camera = 4;
    expect(reader.observe(raw).phase).toBe("menu");
    raw.camera = 0;
    expect(reader.observe(raw)).toMatchObject({
      phase: "racing",
      round: 1,
      engineClass: "100cc",
      mirror: true,
      lapCount: 3,
    });
  });
  it("freezes human results and original selections while CPUs continue racing", () => {
    const reader = new MkwTelemetry();
    const raw = probe();
    reader.observe(raw);
    const winner = raw.players[0];
    if (winner === undefined) throw new Error("missing fixture");
    winner.finished = true;
    winner.timeMs = 61_234;
    reader.observe(raw);
    winner.placement = 5;
    winner.timeMs = 80_000;
    winner.characterId = 24;
    raw.courseId = 1;
    expect(reader.observe(raw)).toMatchObject({
      courseId: 8,
      racers: [
        {
          human: true,
          characterId: 0,
          placement: 1,
          timeMs: 61_234,
          finished: true,
        },
        {},
        {},
        {},
        { human: false, seat: null },
      ],
    });
    raw.stage = 4;
    expect(reader.observe(raw).phase).toBe("finished");
  });
  it("resets canceled races and identifies the next race even if its allocation is reused", () => {
    const reader = new MkwTelemetry();
    const raw = probe();
    reader.observe(raw);
    raw.stage = null;
    expect(reader.observe(raw).phase).toBe("menu");
    raw.stage = 1;
    expect(reader.observe(raw).phase).toBe("staging");
    raw.stage = 2;
    expect(reader.observe(raw).round).toBe(2);
  });
});
