import { describe, expect, test } from "vitest";
import {
  AuthoredCombatCapture,
  AuthoredCombatProbe,
  summarizeAuthoredCombat,
} from "./wire.ts";

const match = "11111111-1111-4111-8111-111111111111";
const world = "22222222-2222-4222-8222-222222222222";
const human = "33333333-3333-4333-8333-333333333333";
const bot = "44444444-4444-4444-8444-444444444444";
function effective() {
  return {
    host: {
      match,
      enabled: true,
      host: human,
      locked: true,
      selectedDifficulty: "HARD",
      currentDifficulty: "HARD",
    },
    profile: {
      body: bot,
      personality: "test-roster-personality",
      levers: {
        reactionMs: 250,
        aimErrorDeg: 2,
        turnRateDegPerTick: 30,
        cps: 9,
        predictionQuality: 0.7,
        decisionTemperature: 0.3,
        awarenessRadius: 50,
        coordination: 0.7,
        technique: 0.7,
        aggression: 0.7,
      },
      style: { aggression: 0.7, patience: 0.4, teamplay: 0.6, risk: 0.5 },
    },
  };
}
function frame(sequence: number, serverTick: number, health: number) {
  const actor = {
    world,
    kit: "trooper",
    alive: true,
    physicallyAlive: true,
    valid: true,
    online: true,
    mode: "SURVIVAL",
    invulnerable: false,
    health: 20,
    absorption: 0,
    noDamageTicks: 0,
    position: [0, 65, 0],
    foodLevel: 20,
    saturation: 20,
  };
  return {
    sequence,
    serverTick,
    match,
    world,
    phase: "LIVE",
    difficulty: "HARD",
    human: { ...actor, body: human, team: "red", health },
    bot: { ...actor, body: bot, team: "blue" },
    effective: effective(),
  };
}
function capture() {
  return AuthoredCombatCapture.parse({
    version: 2,
    kind: "rwf-authored-npc-human-combat",
    humanDemonstration: false,
    authoredBotControl: true,
    state: "closed",
    message: "",
    match,
    world,
    human,
    bot,
    experience:
      "experience-v1;seed=-42;difficulty=hard;style=varied;variety=high;maps=;kits=trooper",
    effective: effective(),
    startedTick: 100,
    sampledTick: 103,
    dropped: 0,
    pending: 0,
    environment: {
      originalDifficulty: "PEACEFUL",
      currentDifficulty: "PEACEFUL",
      restored: true,
    },
    frames: [frame(0, 100, 20), frame(5, 103, 17.6)],
    hits: [
      {
        sequence: 4,
        cause: "ENTITY_ATTACK",
        cancelled: true,
        before: frame(1, 101, 20),
        monitor: frame(2, 101, 17.6),
        after: frame(3, 102, 17.6),
      },
    ],
  });
}

describe("ordinary authored NPC to joined human health proof", () => {
  test("requires custom RWF cancellation plus real retained native HP loss", () => {
    expect(summarizeAuthoredCombat(capture())).toMatchObject({
      nativeMeleeEvents: 1,
      damagingMeleeEvents: 1,
      retainedHealthLoss: 20 - 17.6,
      humanDemonstration: false,
      authoredBotControl: true,
    });
  });
  test("raw readiness preserves different kits and transient body protection without certifying them", () => {
    const raw = frame(0, 100, 20);
    raw.bot.kit = "juggernaut";
    raw.bot.health = 30;
    raw.human.invulnerable = true;
    raw.human.valid = false;
    const probe = AuthoredCombatProbe.parse({
      ready: false,
      message: "native bodies not ready",
      frame: raw,
    });
    expect(probe.frame.bot.kit).toBe("juggernaut");
    expect(probe.frame.bot.health).toBe(30);
    expect(probe.frame.human.valid).toBe(false);
    expect(probe.frame.human.invulnerable).toBe(true);
    const failed = capture();
    failed.hits[0]!.before.bot.kit = "juggernaut";
    expect(() => summarizeAuthoredCombat(failed)).toThrow();
  });
  test("a swing, uncancelled vanilla event or absorption-only change cannot pass", () => {
    for (const cancelled of [true, false]) {
      const value = capture();
      value.hits[0]!.cancelled = cancelled;
      value.hits[0]!.monitor.human.health = 20;
      value.hits[0]!.after.human.health = 20;
      expect(() => summarizeAuthoredCombat(value)).toThrow();
    }
    const vanilla = capture();
    vanilla.hits[0]!.cancelled = false;
    expect(() => summarizeAuthoredCombat(vanilla)).toThrow();
    const absorption = capture();
    absorption.hits[0]!.before.human.absorption = 5;
    absorption.hits[0]!.monitor.human.absorption = 2;
    absorption.hits[0]!.after.human.absorption = 2;
    absorption.hits[0]!.monitor.human.health = 20;
    absorption.hits[0]!.after.human.health = 20;
    expect(() => summarizeAuthoredCombat(absorption)).toThrow();
  });
  test("spectators and native protection cannot establish joined damage", () => {
    for (const point of ["before", "monitor", "after"] as const) {
      const value = capture();
      value.hits[0]![point].human.invulnerable = true;
      expect(() => summarizeAuthoredCombat(value)).toThrow();
    }
    const value = capture();
    value.hits[0]!.before.human.mode = "SPECTATOR";
    expect(() => summarizeAuthoredCombat(value)).toThrow();
  });
  test("binds every event stage to original actors, match, world and life", () => {
    for (const mutate of [
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.match = world;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.bot.body = world;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.monitor.human.world = match;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.human.alive = false;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.bot.valid = false;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.human.online = false;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.before.bot.team = "red";
      },
    ]) {
      const value = capture();
      mutate(value);
      expect(() => summarizeAuthoredCombat(value)).toThrow();
    }
  });
  test("MONITOR loss alone cannot replace retained next-tick damage", () => {
    const value = capture();
    value.hits[0]!.after.human.health = 20;
    expect(() => summarizeAuthoredCombat(value)).toThrow();
  });
  test("rejects stale/deferred/missing/repeated observations and truncated streams", () => {
    for (const mutate of [
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.serverTick = value.hits[0]!.before.serverTick;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.serverTick = 103;
      },
      (value: ReturnType<typeof capture>) => {
        value.hits[0]!.after.sequence = 2;
      },
      (value: ReturnType<typeof capture>) => {
        value.pending = 1;
      },
      (value: ReturnType<typeof capture>) => {
        value.dropped = 1;
      },
      (value: ReturnType<typeof capture>) => {
        value.state = "failed";
      },
      (value: ReturnType<typeof capture>) => {
        value.hits = [];
      },
      (value: ReturnType<typeof capture>) => {
        value.sampledTick = 1301;
      },
    ]) {
      const value = capture();
      mutate(value);
      expect(() => summarizeAuthoredCombat(value)).toThrow();
    }
  });
  test("requires actual HARD trial observations and restored original difficulty", () => {
    const value = capture();
    value.hits[0]!.monitor.difficulty = "PEACEFUL";
    expect(() => summarizeAuthoredCombat(value)).toThrow();
    const leaked = capture();
    leaked.environment.currentDifficulty = "HARD";
    expect(() => summarizeAuthoredCombat(leaked)).toThrow();
  });
  test("declared hard experience cannot stand in for Normal or next-round host difficulty", () => {
    for (const mutate of [
      (value: ReturnType<typeof capture>) => {
        value.effective.host.currentDifficulty = "NORMAL";
      },
      (value: ReturnType<typeof capture>) => {
        value.effective.host.selectedDifficulty = "NORMAL";
      },
      (value: ReturnType<typeof capture>) => {
        value.effective.host.locked = false;
      },
      (value: ReturnType<typeof capture>) => {
        value.effective.host.enabled = false;
      },
      (value: ReturnType<typeof capture>) => {
        value.effective.host.host = bot;
      },
      (value: ReturnType<typeof capture>) => {
        value.effective.host.match = world;
      },
      (value: ReturnType<typeof capture>) => {
        value.effective.profile.body = human;
      },
    ]) {
      const value = capture();
      mutate(value);
      expect(() => summarizeAuthoredCombat(value)).toThrow();
    }
  });
  test("all event stages retain the actual installed personality and complete effective levers", () => {
    const summary = summarizeAuthoredCombat(capture());
    expect(summary.effective.profile.levers).toEqual(
      effective().profile.levers,
    );
    expect(summary.declaredExperience).toContain("difficulty=hard");
    for (const point of ["before", "monitor", "after"] as const) {
      const value = capture();
      value.hits[0]![point].effective.profile.levers.cps = 8;
      expect(() => summarizeAuthoredCombat(value)).toThrow();
    }
    const incomplete = capture();
    expect(() =>
      AuthoredCombatCapture.parse({
        ...incomplete,
        effective: {
          ...incomplete.effective,
          profile: { ...incomplete.effective.profile, levers: { cps: 9 } },
        },
      }),
    ).toThrow();
    const invalid = capture();
    invalid.effective.profile.levers.reactionMs = 149;
    expect(() => summarizeAuthoredCombat(invalid)).toThrow();
  });
  test("unknown fields and non-authored or genuine-human labels fail strictly", () => {
    expect(() =>
      summarizeAuthoredCombat({ ...capture(), extra: true }),
    ).toThrow();
    expect(() =>
      summarizeAuthoredCombat({ ...capture(), authoredBotControl: false }),
    ).toThrow();
    expect(() =>
      summarizeAuthoredCombat({ ...capture(), humanDemonstration: true }),
    ).toThrow();
  });
});
