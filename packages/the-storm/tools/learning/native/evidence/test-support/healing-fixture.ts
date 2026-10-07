import {
  HealingIdentity,
  healingRequests,
} from "#learning/native/regression/healing-gate.ts";
import type { NativeCommand } from "#learning/native/regression/console.ts";
import {
  RegressionSample,
  type RegressionAction,
} from "#learning/native/regression-client.ts";
import type { RegressionCommand } from "#learning/native/regression-gate.ts";

const match = "11111111-1111-4111-8111-111111111111";
const body = "22222222-2222-4222-8222-222222222222";

/** Synthetic boundary fixtures only; no human, native or model acceptance evidence. */
export function fixtureRoster() {
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

export function healingFixture() {
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
