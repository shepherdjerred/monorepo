import { MeleeIdentity, meleeRequests } from "./melee-gate.ts";
import { MeleeProbe } from "./melee-wire.ts";
import type { NativeCommand } from "./console.ts";
import wire from "#learning-melee-wire";
import {
  RegressionSample,
  type RegressionAction,
} from "#learning/native/regression-client.ts";
import type { RegressionCommand } from "#learning/native/regression-gate.ts";

const match = "11111111-1111-4111-8111-111111111111";
const attacker = "22222222-2222-4222-8222-222222222222";
const victim = "33333333-3333-4333-8333-333333333333";

function initialSample() {
  return RegressionSample.parse({
    protocol: 2,
    contract: "rwf-regression-capture-v2",
    ready: true,
    caseName: "native-los-and-knockback",
    match,
    result: "armed",
    phase: "LOBBY",
    sequence: 0,
    actions: [],
    ticks: [],
    damage: [],
    probes: [],
    transitions: [],
    inference: {
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
    },
  });
}

function actions() {
  const first: RegressionAction = {
    sequence: 2,
    serverTick: 100,
    botTick: 10,
    match,
    body: attacker,
    life: 0,
    kit: "TROOPER",
    decision: "unavailable",
    heldSlot: 1,
    usingItem: false,
    targetId: 2,
    targetBody: victim,
    x: 2,
    y: 65,
    z: 3,
    health: 20,
    absorption: 0,
    authored: ["Stop[]"],
    commands: ["Stop[]"],
    ticket: null,
  };
  const applied: RegressionAction = {
    ...first,
    sequence: 5,
    serverTick: 101,
    botTick: 11,
    decision: "applied",
    commands: [
      "Stop[]",
      "Sneak[sneaking=false]",
      "Swing[]",
      "Attack[target=#2]",
    ],
    ticket: {
      match,
      body: attacker,
      life: 0,
      tick: 10,
      yaw: 0,
      action: {
        move: 4,
        jump: false,
        sneak: false,
        sprint: false,
        attack: true,
      },
    },
  };
  return { first, applied };
}

function body(id: string, point: number[]) {
  const [x, y, z, yaw, pitch] = point;
  return {
    body: id,
    x,
    y,
    z,
    yaw,
    pitch,
    health: 20,
    absorption: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    heldSlot: 1,
    weapon: "IRON_SWORD",
    knockbackLevel: 0,
    sprinting: false,
    gameMode: "SURVIVAL",
    invulnerable: false,
  };
}

function probe(trial: "blocked" | "clear") {
  return MeleeProbe.parse({
    protocol: 1,
    contract: "rwf-native-melee-check-v1",
    match,
    phase: "LIVE",
    world: "rwf",
    serverTick: 100,
    trial,
    attackerBefore: body(attacker, wire.attacker),
    victimBefore: body(victim, wire.victim),
    attackerAfter: body(attacker, wire.attacker),
    victimAfter: {
      ...body(victim, wire.victim),
      health: trial === "clear" ? 17.1 : 20,
      velocityX: trial === "clear" ? 0.4 : 0,
      velocityY: trial === "clear" ? 0.4 : 0,
    },
    reachable: true,
    visible: trial === "clear",
    wallBefore: ["minecraft:air", "minecraft:air"],
    wallDuring:
      trial === "blocked"
        ? ["minecraft:stone", "minecraft:stone"]
        : ["minecraft:air", "minecraft:air"],
    wallAfter: ["minecraft:air", "minecraft:air"],
    refusal: trial === "blocked" ? "NO_LINE_OF_SIGHT" : "",
  });
}

/** Synthetic replay boundaries only; never usable as native, demonstration or model evidence. */
export function meleeFixture() {
  const identity = MeleeIdentity.parse({
    schema: 1,
    source: "automated-regression-console",
    humanDemonstration: false,
    match,
    attacker,
    victim,
  });
  const fighters = [
    attacker,
    victim,
    ...Array.from(
      { length: 14 },
      (_, i) => `66666666-6666-4666-8666-${i.toString().padStart(12, "0")}`,
    ),
  ].map((id, i) => ({
    body: id,
    bot: true,
    alive: true,
    personality: `boundary-${i.toString()}`,
    team: i % 2 === 0 ? ("red" as const) : ("blue" as const),
    kit: "trooper" as const,
  }));
  const sample = initialSample();
  if (sample.inference === null)
    throw new Error("Synthetic inference counters missing");
  const metrics = sample.inference;
  const counted = (count: number) => ({
    ...metrics,
    submitted: count,
    timely: count,
    deadlineMet: count,
    maximumBatch: 1,
  });
  const { first, applied } = actions();
  const direct = {
    sequence: 4,
    serverTick: 100,
    attacker,
    victim,
    cause: "ENTITY_ATTACK",
    cancelled: true,
    before: 20,
    after: 17.1,
    velocityX: 0.4,
    velocityY: 0.4,
    velocityZ: 0,
  };
  const hit = {
    ...direct,
    sequence: 6,
    serverTick: 101,
    before: 17.1,
    after: 14.2,
  };
  const commands: RegressionCommand[] = [
    { command: "load", state: { ...sample, caseName: "", match: "" } },
    { command: "arm native-los-and-knockback 16", state: sample },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 3,
        phase: "LIVE",
        result: "live",
        actions: [first],
        ticks: [
          {
            sequence: 3,
            serverTick: 100,
            botTick: 10,
            milliseconds: 12,
            live: true,
            batchRows: 1,
          },
        ],
        transitions: [
          {
            sequence: 1,
            serverTick: 100,
            match,
            event: "ForceStart",
            phase: "LIVE",
            winner: "",
            fighters,
          },
        ],
        inference: counted(1),
      },
    },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 4,
        phase: "LIVE",
        result: "live",
        damage: [direct],
        inference: counted(1),
      },
    },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 9,
        phase: "ENDED",
        result: "ended",
        actions: [applied],
        damage: [hit],
        ticks: [
          {
            sequence: 7,
            serverTick: 101,
            botTick: 11,
            milliseconds: 12,
            live: true,
            batchRows: 1,
          },
          {
            sequence: 9,
            serverTick: 102,
            botTick: 12,
            milliseconds: 12,
            live: true,
            batchRows: 0,
          },
        ],
        transitions: [
          {
            sequence: 8,
            serverTick: 102,
            match,
            event: "Tick",
            phase: "ENDED",
            winner: "red",
            fighters: fighters.map((row) => ({
              ...row,
              alive: row.team === "red",
            })),
          },
        ],
        inference: counted(2),
      },
    },
    {
      command: "release",
      state: {
        ...sample,
        sequence: 9,
        phase: "ENDED",
        result: "released",
        inference: counted(2),
      },
    },
  ];
  const { native, get, editProbe } = nativeFixture(identity);
  const recording = [
    `H\t3\t${match}\ttraining-yard`,
    ...fighters.map(
      (row, i) =>
        `R\tp${i.toString(16).padStart(16, "0")}\t${row.team.toUpperCase()}\t${row.kit}\ttrue`,
    ),
    "X\t12\tRED\tLAST_TEAM_STANDING",
  ].join("\n");
  return {
    commands,
    native,
    identity,
    recording,
    get,
    editProbe,
    applied,
    direct,
    hit,
  };
}

function nativeFixture(identity: MeleeIdentity) {
  const native: NativeCommand[] = meleeRequests(identity).map(
    ([key, command], i) => ({
      sequence: i + 1,
      key,
      command,
      response: "",
      startSequence: i === 0 ? 0 : i === 4 ? 9 : 3,
      endSequence: i === 4 ? 9 : i === 3 ? 4 : 3,
      startPhase: i === 0 ? "LOBBY" : i === 4 ? "ENDED" : "LIVE",
      endPhase: i === 4 ? "ENDED" : "LIVE",
    }),
  );
  const get = (key: string) => {
    const row = native.find((entry) => entry.key === key);
    if (row === undefined) throw new Error("Synthetic melee request missing");
    return row;
  };
  get("live-status").response =
    `Match ${identity.match}, map training-yard, 0 humans, 16 bots`;
  get("blocked").response = JSON.stringify(probe("blocked"));
  get("clear").response = JSON.stringify(probe("clear"));
  const editProbe = (key: string, edit: (value: MeleeProbe) => void) => {
    const value = MeleeProbe.parse(JSON.parse(get(key).response));
    edit(value);
    get(key).response = JSON.stringify(value);
  };
  return { native, get, editProbe };
}
