import { describe, expect, it } from "vitest";
import {
  HealingIdentity,
  healingLifecycle,
  healingRequests,
  healingRoster,
} from "./healing-gate.ts";
import type { NativeCommand } from "./console.ts";
import {
  RegressionSample,
  type RegressionAction,
} from "#learning/native/regression-client.ts";
import type { RegressionCommand } from "#learning/native/regression-gate.ts";

const match = "11111111-1111-4111-8111-111111111111";
const body = "22222222-2222-4222-8222-222222222222";

/** Synthetic boundary fixtures only; no human, native or model acceptance evidence. */
function fixtureRoster() {
  const fighters = Array.from({ length: 16 }, (_, i) => ({
    body:
      i === 0
        ? body
        : `66666666-6666-4666-8666-${i.toString().padStart(12, "0")}`,
    bot: true,
    alive: true,
    personality: `boundary-${i.toString()}`,
    team: i % 2 === 0 ? ("red" as const) : ("blue" as const),
    kit: "trooper" as const,
  }));
  const identity = HealingIdentity.parse({
    schema: 1,
    source: "automated-regression-console",
    humanDemonstration: false,
    match,
    healer: body,
    personalities: fighters.map((row, i) => ({
      id: row.personality,
      name: i === 0 ? "Healer" : `Boundary${i.toString()}`,
      quirks: [],
      sha256: "a".repeat(64),
    })),
  });
  const opponent = fighters[1];
  if (opponent === undefined) throw new Error("Synthetic opponent missing");
  return { fighters, identity, opponent };
}

function fixture() {
  const { fighters, identity, opponent } = fixtureRoster();
  const metrics = {
    submitted: 0,
    skipped: 0,
    timely: 0,
    stale: 0,
    expired: 0,
    contextDrops: 0,
    deadlineMet: 0,
    deadlineMissed: 0,
    resets: 0,
    rejected: 0,
    hits: 0,
    misses: 0,
    maximumNanos: 0,
    maximumBatch: 0,
  };
  const sample = RegressionSample.parse({
    protocol: 2,
    contract: "rwf-regression-capture-v2",
    ready: true,
    caseName: "healing-and-lifecycle",
    match,
    result: "armed",
    phase: "LOBBY",
    sequence: 0,
    actions: [],
    ticks: [],
    damage: [],
    probes: [],
    transitions: [],
    inference: metrics,
  });
  const first = action({ sequence: 2, serverTick: 99, botTick: 9 });
  const eating = Array.from({ length: 33 }, (_, i) =>
    action({
      sequence: 4 + 2 * i,
      serverTick: 100 + i,
      botTick: 10 + i,
      heldSlot: i === 0 ? 1 : 2,
      usingItem: i > 0 && i < 32,
      health: 8,
      absorption: i === 32 ? 4 : 0,
      authored:
        i === 0
          ? ["SelectSlot[slot=2]", "StartUse[]", "Stop[]"]
          : i === 32
            ? ["ReleaseUse[]", "Stop[]"]
            : ["Stop[]"],
    }),
  );
  const applied = action({
    sequence: 70,
    serverTick: 133,
    botTick: 43,
    decision: "applied",
    targetId: 2,
    targetBody: opponent.body,
    health: 9,
    absorption: 4,
    ticket: {
      match,
      body,
      life: 0,
      tick: 42,
      yaw: 0,
      action: {
        move: 4,
        jump: false,
        sneak: false,
        sprint: false,
        attack: false,
      },
    },
  });
  applied.commands = ["Stop[]", "Sneak[sneaking=false]"];
  const counted = (count: number) => ({
    ...metrics,
    submitted: count,
    timely: count,
    deadlineMet: count,
    maximumBatch: 1,
  });
  const commands: RegressionCommand[] = [
    { command: "load", state: { ...sample, caseName: "", match: "" } },
    { command: "arm healing-and-lifecycle 16", state: sample },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 3,
        phase: "LIVE",
        result: "live",
        actions: [first],
        ticks: [tick(first)],
        inference: counted(1),
        transitions: [
          {
            sequence: 1,
            serverTick: 99,
            match,
            event: "ForceStart",
            phase: "LIVE",
            winner: "",
            fighters,
          },
        ],
      },
    },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 69,
        phase: "LIVE",
        result: "live",
        actions: eating,
        ticks: eating.map((row) => tick(row)),
        inference: counted(34),
      },
    },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 71,
        phase: "LIVE",
        result: "live",
        actions: [applied],
        ticks: [tick(applied)],
        inference: counted(35),
      },
    },
    {
      command: "finish",
      state: {
        ...sample,
        sequence: 72,
        phase: "RESETTING",
        result: "stopped",
        inference: counted(35),
        transitions: [
          {
            sequence: 72,
            serverTick: 134,
            match,
            event: "Stop",
            phase: "RESETTING",
            winner: "",
            fighters: [],
          },
        ],
      },
    },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 72,
        phase: "LOBBY",
        result: "stopped",
        inference: counted(35),
      },
    },
    {
      command: "release",
      state: {
        ...sample,
        sequence: 72,
        phase: "LOBBY",
        result: "released",
        inference: counted(35),
      },
    },
  ];
  const { native, get } = nativeFixture(
    identity,
    fighters.map((row) => row.body).sort(),
  );
  const recording = [
    `H\t3\t${match}\ttraining-yard`,
    ...fighters.map(
      (row, i) =>
        `R\tp${i.toString(16).padStart(16, "0")}\t${row.team.toUpperCase()}\t${row.kit}\ttrue`,
    ),
    "X\t12\t-\tSTOPPED",
  ].join("\n");
  return {
    commands,
    native,
    identity,
    recording,
    npcSave: "# Citizens NPC Storage\n{}",
    get,
    eating,
    fighters,
    applied,
  };
}

function action(changes: Partial<RegressionAction>) {
  const row: RegressionAction = {
    sequence: 2,
    serverTick: 99,
    botTick: 9,
    match,
    body,
    life: 0,
    kit: "TROOPER",
    decision: "ineligible",
    heldSlot: 1,
    usingItem: false,
    targetId: null,
    targetBody: null,
    x: 2,
    y: 65,
    z: 3,
    health: 20,
    absorption: 0,
    authored: ["Stop[]"],
    commands: ["Stop[]"],
    ticket: null,
    ...changes,
  };
  row.commands = [...row.authored];
  return row;
}

function tick(row: RegressionAction) {
  return {
    sequence: row.sequence + 1,
    serverTick: row.serverTick,
    botTick: row.botTick,
    milliseconds: 12,
    live: true,
    batchRows: 1,
  };
}

function nativeFixture(identity: HealingIdentity, bodies: string[]) {
  const native: NativeCommand[] = healingRequests(body, bodies).map(
    ([key, command], i) => ({
      sequence: i + 1,
      key,
      command,
      response: "Test passed. Count: 1",
      startSequence: i === 0 ? 0 : i >= 28 ? 72 : i >= 25 ? 69 : 3,
      endSequence: i >= 28 ? 72 : i >= 25 ? 69 : 3,
      startPhase: i === 0 ? "LOBBY" : i >= 28 ? "LOBBY" : "LIVE",
      endPhase: i >= 28 ? "LOBBY" : "LIVE",
    }),
  );
  const get = (key: string) => {
    const row = native.find((entry) => entry.key === key);
    if (row === undefined) throw new Error("Synthetic healing request missing");
    return row;
  };
  for (const id of bodies) get(`ended-body-${id}`).response = "Test failed";
  for (const key of ["save-live", "save-ended"])
    get(key).response = "§aSaving Citizens... \n§aCitizens saved.\n";
  for (const key of ["registry-live", "registry-ended"])
    get(key).response = "§e=====[ NPCs §f1/1 §e]=====\n";
  get("live-status").response =
    `Match ${identity.match}, map training-yard, 0 humans, 16 bots`;
  get("end-debug").response = "no bots in the match";
  for (const [key, value] of [
    ["health-before", 20],
    ["health-hurt", 8],
    ["health-after", 9],
    ["absorption-before", 0],
    ["absorption-after", 4],
  ] as const)
    get(key).response =
      `Healer has the following entity data: ${value.toString()}.0f`;
  get("hurt").response = "Applied 12.0 damage to Healer";
  return { native, get };
}

function mutateHealth(value: ReturnType<typeof fixture>, edit: string) {
  if (edit === "inventory") value.get("apples-after").response = "Test failed";
  if (edit === "recovery")
    value.get("health-after").response =
      "Healer has the following entity data: 8.0f";
  if (edit === "absorption")
    value.get("absorption-after").response =
      "Healer has the following entity data: 0.0f";
  if (edit === "name")
    value.get("health-after").response =
      "Other has the following entity data: 9.0f";
  if (edit === "damage")
    value.get("hurt").response =
      "Target is invulnerable to the given damage type";
  if (edit === "live-body")
    value.get(`live-body-${body}`).response = "Test failed";
  if (edit === "retired-body")
    value.get(`ended-body-${body}`).response = "Test passed. Count: 1";
}

function mutateFinish(value: ReturnType<typeof fixture>, edit: string) {
  if (edit === "no-finish") {
    const row = value.commands.find((entry) => entry.command === "finish");
    if (row === undefined) throw new Error("Synthetic finish missing");
    row.command = "sample";
  }
  if (edit === "second-finish") {
    const row = value.commands.find((entry) => entry.command === "release");
    if (row === undefined) throw new Error("Synthetic release missing");
    row.command = "finish";
  }
}

describe("original native healing and lifecycle", () => {
  it("requires consumption, actual recovery, the authored eating interval and all body cleanup", () => {
    expect(healingLifecycle(fixture()).healing).toEqual({
      healer: body,
      before: 20,
      hurt: 8,
      after: 9,
      absorption: 4,
      life: 0,
      eatingTicks: 32,
      applesBefore: 3,
      applesAfter: 2,
      botsDespawned: 16,
      savedNpcs: 0,
    });
  });

  it.each(["never_eats", "gapple_hoarder"])(
    "respects original %s without changing the draft",
    (quirk) => {
      const value = fixture();
      const first = value.identity.personalities[0];
      if (first === undefined)
        throw new Error("Synthetic first personality missing");
      first.quirks.push(quirk);
      expect(
        healingRoster(value.fighters, value.identity.personalities).healer.body,
      ).toBe(value.fighters[1]?.body);
      expect(() => healingLifecycle(value)).toThrow();
    },
  );

  it("requires the Stop to be drained by the original finish command", () => {
    const value = fixture();
    const finish = value.commands.find((row) => row.command === "finish");
    const later = value.commands.find(
      (row) => row.state.phase === "LOBBY" && row.state.result === "stopped",
    );
    if (finish === undefined || later === undefined)
      throw new Error("Synthetic finish boundary missing");
    finish.command = "sample";
    later.command = "finish";
    expect(() => healingLifecycle(value)).toThrow();
  });

  it("requires every personality before selecting a healer", () => {
    const value = fixture();
    const last = value.identity.personalities.at(-1);
    if (last === undefined)
      throw new Error("Synthetic last personality missing");
    last.id = "foreign-personality";
    expect(() => healingLifecycle(value)).toThrow();
  });

  it.each([
    "inventory",
    "recovery",
    "absorption",
    "name",
    "damage",
    "live-body",
    "retired-body",
    "registry",
    "save",
    "phase",
    "command",
    "lost-command",
    "saved-npc",
    "missing-save",
    "recording",
    "human-input",
  ])("rejects changed original %s evidence", (edit) => {
    const value = fixture();
    mutateHealth(value, edit);
    if (edit === "registry") value.get("registry-live").response += "\nHealer";
    if (edit === "save")
      value.get("save-ended").response = "Saving Citizens...";
    if (edit === "phase") value.get("health-after").startPhase = "LOBBY";
    if (edit === "command")
      value.get("hurt").command = `damage ${body} 12 minecraft:generic`;
    if (edit === "lost-command") value.native.splice(22, 1);
    if (edit === "saved-npc") value.npcSave = "npc:\n  1:\n    name: Healer";
    if (edit === "missing-save") value.npcSave = "";
    if (edit === "recording")
      value.recording = value.recording.replace("STOPPED", "DRAW");
    if (edit === "human-input") value.recording += "\nN\t0\tplayer";
    expect(() => healingLifecycle(value)).toThrow();
  });

  it.each([
    "start",
    "release",
    "use",
    "override",
    "life",
    "body",
    "native-window",
    "short-interval",
    "no-finish",
    "second-finish",
  ])("rejects changed original item or stop %s evidence", (edit) => {
    const value = fixture();
    mutateFinish(value, edit);
    const start = value.eating[0];
    const using = value.eating[1];
    const released = value.eating[32];
    if (start === undefined || using === undefined || released === undefined)
      throw new Error("Synthetic item controls missing");
    if (edit === "start") start.authored = start.commands = ["Stop[]"];
    if (edit === "release") released.authored = released.commands = ["Stop[]"];
    if (edit === "use") for (const row of value.eating) row.usingItem = false;
    if (edit === "override") using.commands = ["Jump[]"];
    if (edit === "life") released.life++;
    if (edit === "body") released.body = match;
    if (edit === "native-window") value.get("apples-after").startSequence = 3;
    if (edit === "short-interval") {
      released.botTick--;
      released.serverTick--;
    }
    expect(() => healingLifecycle(value)).toThrow();
  });
});
