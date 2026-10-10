import {
  RegressionSample,
  type RegressionAction,
} from "#learning/native/regression-client.ts";
import { type RegressionCommand } from "#learning/native/regression-gate.ts";
import {
  WatcherIdentity,
  watcherRequests,
} from "#learning/native/regression/watcher-gate.ts";
import type { NativeCommand } from "#learning/native/regression/console.ts";

const match = "11111111-1111-4111-8111-111111111111";
const attacker = "22222222-2222-4222-8222-222222222222";
const victim = "33333333-3333-4333-8333-333333333333";
const watcher = "55555555-5555-4555-8555-555555555555";

/** Synthetic boundary fixtures only; they never establish native or model acceptance. */
export function watcherFixture() {
  const identity = WatcherIdentity.parse({
    schema: 1,
    source: "automated-regression-client",
    command: "/rwf spectate",
    humanDemonstration: false,
    match,
    watcher,
    name: "RwfSpectator",
    attacker,
    victim,
  });
  const metrics = emptyInference();
  const sample = RegressionSample.parse({
    protocol: 2,
    contract: "rwf-regression-capture-v2",
    ready: true,
    caseName: "spectator-immunity",
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
  const fighters = [
    attacker,
    victim,
    ...Array.from(
      { length: 14 },
      (_, i) => `66666666-6666-4666-8666-${i.toString().padStart(12, "0")}`,
    ),
  ].map((body, i) => ({
    body,
    bot: true,
    personality: `boundary-${i.toString()}`,
    team: i % 2 === 0 ? ("red" as const) : ("blue" as const),
    kit: "trooper" as const,
    alive: true,
  }));
  const { first, applied } = syntheticActions();
  const damage = {
    sequence: 3,
    serverTick: 100,
    attacker,
    victim,
    cause: "ENTITY_ATTACK",
    cancelled: true,
    before: 20,
    after: 17.1,
    velocityX: 0.4,
    velocityY: 0.36,
    velocityZ: 0,
  };
  const terminal = {
    ...sample,
    sequence: 7,
    phase: "ENDED" as const,
    result: "ended" as const,
    actions: [applied],
    ticks: [
      {
        sequence: 4,
        serverTick: 100,
        botTick: 10,
        milliseconds: 12,
        live: true,
        batchRows: 1,
      },
      {
        sequence: 7,
        serverTick: 101,
        botTick: 11,
        milliseconds: 12,
        live: true,
        batchRows: 0,
      },
    ],
    transitions: [
      {
        sequence: 6,
        serverTick: 101,
        match,
        event: "Tick",
        phase: "ENDED" as const,
        winner: "red" as const,
        fighters: fighters.map((row) => ({
          ...row,
          alive: row.team === "red",
        })),
      },
    ],
    inference: {
      ...metrics,
      submitted: 1,
      timely: 1,
      deadlineMet: 1,
      maximumBatch: 1,
    },
  };
  const commands: RegressionCommand[] = [
    { command: "load", state: { ...sample, match: "", caseName: "" } },
    { command: "arm spectator-immunity 16", state: sample },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 2,
        phase: "LIVE",
        result: "live",
        actions: [first],
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
      },
    },
    {
      command: "sample",
      state: {
        ...sample,
        sequence: 3,
        phase: "LIVE",
        result: "live",
        damage: [damage],
      },
    },
    { command: "sample", state: terminal },
    {
      command: "release",
      state: {
        ...sample,
        sequence: 7,
        phase: "ENDED",
        result: "released",
        inference: terminal.inference,
      },
    },
  ];
  const { native, get } = nativeFixture(identity);
  const recording = [
    `H\t3\t${match}\ttraining-yard`,
    ...fighters.map((row) => `R\t${row.body}\t${row.team}\t${row.kit}\ttrue`),
    "X\t12\tRED\tLAST_TEAM_STANDING",
  ].join("\n");
  return { commands, native, identity, recording, get, damage, applied };
}

function syntheticActions() {
  const first = unavailableAction(match, attacker, victim, [
    "Look[yaw=0.0, pitch=0.0]",
    "Stop[]",
  ]);
  const applied: RegressionAction = {
    ...first,
    sequence: 5,
    serverTick: 101,
    botTick: 11,
    decision: "applied",
    commands: [
      "Look[yaw=0.0, pitch=0.0]",
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

function nativeFixture(identity: WatcherIdentity) {
  const native: NativeCommand[] = watcherRequests(identity).map(
    ([key, command], index) => ({
      sequence: index + 1,
      key,
      command,
      response: "Target is invulnerable to the given damage type",
      startSequence: index === 0 ? 0 : 2,
      startPhase: index === 0 ? "LOBBY" : "LIVE",
      endSequence: 2,
      endPhase: "LIVE",
    }),
  );
  const get = (key: string) => {
    const row = native.find((entry) => entry.key === key);
    if (row === undefined) throw new Error("Synthetic native request missing");
    return row;
  };
  for (const key of [
    "watcher-present",
    "spectator-mode",
    "end-watcher-present",
    "end-spectator-mode",
  ])
    get(key).response = "Test passed. Count: 1";
  for (const key of [
    "watcher-health-before",
    "watcher-health-after",
    "end-watcher-health",
  ])
    get(key).response = "RwfSpectator has the following entity data: 20.0f";
  get("watcher-position").response =
    "RwfSpectator has the following entity data: [2.0d, 65.0d, 3.0d]";
  get("attacker-position").response =
    "Alpha has the following entity data: [2.0d, 65.0d, 3.0d]";
  get("live-status").response =
    `Match ${match}, map training-yard, 0 humans, 16 bots\nWatchers: 1, showcase: yes`;
  get("end-status").response = "Watchers: 1, showcase: yes";
  get("fighter-health-before").response =
    "Beta has the following entity data: 20.0f";
  get("fighter-health-after").response =
    "Beta has the following entity data: 17.1f";
  get("fighter-damage").endSequence = 3;
  get("fighter-health-after").startSequence = 3;
  get("fighter-health-after").endSequence = 3;
  for (const row of native.slice(15)) {
    row.startSequence = 7;
    row.endSequence = 7;
    row.startPhase = "ENDED";
    row.endPhase = "ENDED";
  }
  return { native, get };
}
import {
  emptyInference,
  unavailableAction,
} from "#learning/native/regression/test-support.ts";
