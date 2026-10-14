import { describe, expect, it } from "vitest";
import {
  MeleeTelemetry,
  MeleeProbeSchema,
} from "#src/games/melee/telemetry.ts";

function probe() {
  return MeleeProbeSchema.parse({
    version: 1,
    frame: 1,
    scene: 2,
    majorMode: 2,
    prepared: true,
    aborted: false,
    matchKind: 0,
    teams: false,
    stageId: 32,
    remainingMs: 120_000,
    players: Array.from({ length: 4 }, (_unused, slot) => ({
      slot,
      port: slot,
      type: 0,
      characterId: slot,
      damage: 0,
      stocks: -1,
      kos: 0,
      falls: 0,
      selfDestructs: 0,
      score: 0,
      placement: null,
    })),
  });
}

describe("Melee game transitions", () => {
  it("rejects menu and result placeholders until a prepared match has been played", () => {
    const reader = new MeleeTelemetry();
    const state = probe();
    state.scene = 5;
    expect(reader.observe(state).phase).toBe("loading");
    state.scene = 2;
    state.prepared = false;
    expect(reader.observe(state).fighters).toEqual([]);
    state.prepared = true;
    expect(reader.observe(state)).toMatchObject({
      phase: "playing",
      round: 1,
      stageId: 32,
      mode: "time",
    });
  });
  it("preserves original characters, controller ports and rules through sudden death", () => {
    const reader = new MeleeTelemetry();
    const state = probe();
    state.players[0]!.port = 3;
    state.players[3]!.port = 0;
    reader.observe(state);
    state.scene = 3;
    state.matchKind = 1;
    state.stageId = 31;
    state.players[0]!.characterId = 18;
    state.players[0]!.port = 0;
    state.players[0]!.stocks = 1;
    expect(reader.observe(state)).toMatchObject({
      phase: "sudden-death",
      mode: "time",
      stageId: 32,
      remainingMs: 0,
      fighters: [
        { seat: 3, characterId: 0, stocks: 1 },
        { seat: 1 },
        { seat: 2 },
        { seat: 0 },
      ],
    });
    state.scene = 5;
    for (const [index, player] of state.players.entries()) {
      player.placement = index + 1;
      player.kos = 3;
      player.falls = 2;
      player.selfDestructs = 1;
      player.score = -1;
    }
    expect(reader.observe(state)).toMatchObject({
      phase: "results",
      fighters: [
        { seat: 3, characterId: 0, winner: true, score: -1, selfDestructs: 1 },
        { winner: false },
        { winner: false },
        { winner: false },
      ],
    });
    state.scene = 2;
    expect(reader.observe(state).round).toBe(2);
  });
  it("does not credit canceled matches and preserves genuine game ties", () => {
    const reader = new MeleeTelemetry();
    const state = probe();
    reader.observe(state);
    state.scene = 5;
    state.aborted = true;
    expect(reader.observe(state).phase).toBe("menu");
    state.aborted = false;
    expect(reader.observe(state).fighters).toEqual([]);
    state.scene = 2;
    reader.observe(state);
    state.scene = 5;
    for (const player of state.players) player.placement = 1;
    expect(
      reader.observe(state).fighters.every((player) => player.winner),
    ).toBe(true);
  });
});
