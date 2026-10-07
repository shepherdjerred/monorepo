import { RegressionSample } from "#learning/native/regression-client.ts";
import { type RegressionCommand } from "#learning/native/regression-gate.ts";

const match = "11111111-1111-4111-8111-111111111111";
const body = "22222222-2222-4222-8222-222222222222";
const opponent = "33333333-3333-4333-8333-333333333333";
const caseName = "native-team-advancement";
const empty = {
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

/** Synthetic boundary fixtures only; none are native or model acceptance evidence. */
export function journal(): RegressionCommand[] {
  const sample = RegressionSample.parse({
    protocol: 2,
    contract: "rwf-regression-capture-v2",
    ready: true,
    caseName,
    match,
    result: "armed",
    phase: "LOBBY",
    sequence: 0,
    actions: [],
    ticks: [],
    damage: [],
    probes: [],
    transitions: [],
    inference: empty,
  });
  const first = {
    sequence: 2,
    serverTick: 100,
    botTick: 10,
    match,
    body,
    life: 0,
    kit: "TROOPER",
    decision: "unavailable",
    heldSlot: 1,
    usingItem: false,
    targetId: 2,
    targetBody: opponent,
    x: 2,
    y: 65,
    z: 3,
    health: 20,
    absorption: 0,
    authored: ["Look[yaw=0.0, pitch=0.0]", "Stop[]"],
    commands: ["Look[yaw=0.0, pitch=0.0]", "Stop[]"],
    ticket: null,
  };
  const second = {
    ...first,
    sequence: 4,
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
      body,
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
  const fighters = [
    {
      body,
      bot: true,
      personality: "alpha",
      team: "red",
      kit: "trooper",
      alive: true,
    },
    {
      body: opponent,
      bot: true,
      personality: "beta",
      team: "blue",
      kit: "longbow",
      alive: true,
    },
  ];
  const complete = RegressionSample.parse({
    ...sample,
    result: "released",
    phase: "ENDED",
    sequence: 7,
    actions: [first, second],
    ticks: [
      {
        sequence: 3,
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
        milliseconds: 13,
        live: true,
        batchRows: 0,
      },
    ],
    transitions: [
      {
        sequence: 1,
        serverTick: 100,
        match,
        event: "ForceStarted",
        phase: "LIVE",
        winner: "",
        fighters,
      },
      {
        sequence: 5,
        serverTick: 101,
        match,
        event: "Tick",
        phase: "ENDED",
        winner: "red",
        fighters,
      },
    ],
    damage: [
      {
        sequence: 6,
        serverTick: 101,
        attacker: body,
        victim: opponent,
        cause: "ENTITY_ATTACK",
        cancelled: true,
        before: 20,
        after: 18,
        velocityX: 0.3,
        velocityY: 0.4,
        velocityZ: 0,
      },
    ],
    inference: {
      ...empty,
      submitted: 1,
      timely: 1,
      deadlineMet: 1,
      maximumBatch: 1,
    },
  });
  return [
    { command: "load", state: { ...sample, caseName: "", match: "" } },
    { command: `arm ${caseName} 16`, state: sample },
    { command: "release", state: complete },
  ];
}

export function terminal(rows: RegressionCommand[]) {
  const state = rows.at(-1)?.state;
  if (state === undefined) throw new Error("synthetic terminal is missing");
  return state;
}

export function selected(rows: RegressionCommand[]) {
  const action = terminal(rows).actions[1];
  const ticket = action?.ticket;
  if (ticket === undefined || ticket === null || action === undefined)
    throw new Error("synthetic ticket is missing");
  return { action, ticket };
}

export function humanJournal() {
  const rows = journal();
  for (const row of rows) {
    if (row.state.caseName !== "") row.state.caseName = "human-combat";
    if (row.command.startsWith("arm ")) row.command = "arm human-combat 7";
  }
  const state = terminal(rows);
  for (const row of state.transitions) {
    for (const fighter of row.fighters) {
      fighter.kit = "trooper";
      if (fighter.body === opponent) {
        fighter.bot = false;
        fighter.personality = "";
      }
    }
    row.fighters.push(
      ...Array.from({ length: 6 }, (_, index) => ({
        body: `44444444-4444-4444-8444-${index.toString().padStart(12, "0")}`,
        bot: true,
        personality: `boundary-${index.toString()}`,
        team: "red" as const,
        kit: "trooper" as const,
        alive: true,
      })),
    );
  }
  const first = state.actions[0];
  const second = state.actions[1];
  const firstTick = state.ticks[0];
  const secondTick = state.ticks[1];
  const ending = state.transitions[1];
  const damage = state.damage[0];
  if (
    first === undefined ||
    second === undefined ||
    firstTick === undefined ||
    secondTick === undefined ||
    ending === undefined ||
    damage === undefined
  )
    throw new Error("synthetic human case missing rows");
  first.sequence = 3;
  firstTick.sequence = 4;
  second.sequence = 5;
  damage.sequence = 6;
  ending.sequence = 7;
  secondTick.sequence = 8;
  state.sequence = 8;
  state.probes = [
    {
      sequence: 2,
      serverTick: 100,
      match,
      player: opponent,
      bot: body,
      gameMode: "SURVIVAL",
      invulnerable: false,
      playerAlive: true,
      botAlive: true,
      botKit: "trooper",
      health: 20,
      absorption: 0,
      playerX: 2,
      playerY: 65,
      playerZ: 4.75,
      botX: 2,
      botY: 65,
      botZ: 3,
      botYaw: 0,
    },
  ];
  return rows;
}

export function abortJournal() {
  const rows = humanJournal();
  const state = terminal(rows);
  for (const entry of rows) {
    if (entry.state.caseName !== "") entry.state.caseName = "last-human-abort";
    if (entry.command.startsWith("arm "))
      entry.command = "arm last-human-abort 7";
  }
  const first = state.transitions[0];
  const left = state.transitions[1];
  const tick = state.ticks[1];
  if (
    first === undefined ||
    left === undefined ||
    tick === undefined ||
    state.inference === null
  )
    throw new Error("synthetic abort case missing");
  left.event = "Disconnect";
  left.phase = "LIVE";
  left.winner = "";
  left.fighters = left.fighters.filter((row) => row.bot);
  tick.batchRows = 1;
  const stopped = {
    ...structuredClone(left),
    sequence: 9,
    serverTick: 102,
    event: "Stop",
    phase: "RESETTING" as const,
    fighters: [],
  };
  const lastTick = {
    ...tick,
    sequence: 10,
    serverTick: 102,
    botTick: 12,
    live: false,
    batchRows: 0,
  };
  const metrics = {
    ...state.inference,
    submitted: 2,
    timely: 2,
    deadlineMet: 2,
  };
  const live: RegressionCommand = {
    command: "sample",
    state: {
      ...state,
      result: "live",
      phase: "LIVE",
      sequence: 4,
      actions: state.actions.slice(0, 1),
      ticks: state.ticks.slice(0, 1),
      transitions: [first],
      damage: [],
      inference: { ...metrics, submitted: 1, timely: 1, deadlineMet: 1 },
    },
  };
  const disconnect: RegressionCommand = {
    command: "sample",
    state: {
      ...state,
      result: "live",
      phase: "LIVE",
      actions: state.actions.slice(1),
      ticks: [tick],
      transitions: [left],
      probes: [],
      inference: metrics,
    },
  };
  const released: RegressionCommand = {
    command: "release",
    state: {
      ...state,
      result: "released",
      phase: "LOBBY",
      sequence: 10,
      actions: [],
      ticks: [lastTick],
      transitions: [stopped],
      damage: [],
      probes: [],
      inference: metrics,
    },
  };
  rows.splice(2, 1, live, disconnect, released);
  const ids = [
    opponent,
    ...first.fighters
      .filter((row) => row.bot)
      .map((row) => row.body)
      .sort(),
  ];
  const boundary = {
    schema: 1,
    match,
    player: opponent,
    live: {
      startSequence: 4,
      endSequence: 4,
      phase: "LIVE",
      probes: ids.map((id) => ({
        command: `execute if entity ${id}`,
        response: "Test passed. Count: 1",
      })),
    },
    departed: {
      startSequence: 10,
      endSequence: 10,
      phase: "LOBBY",
      probes: ids.map((id) => ({
        command: `execute if entity ${id}`,
        response: "Test failed",
      })),
    },
    debug: "no bots in the match",
  };
  const settlement = {
    matches: [
      {
        id: match,
        winner: null,
        humans: 1,
        bots: 7,
        recording_file: `rwf/recordings/${match}.rwfrec.gz`,
        recording_bytes: 120,
        dropped_frames: 0,
      },
    ],
    players: [
      {
        player: opponent,
        result: "STOPPED",
        credits_owed: 0,
        payout_status: "NONE",
        credits_paid: 0,
      },
    ],
  };
  const log = `rwf match ${match} has had no humans for PT5S; stopping\nrwf match ${match} stopped by Stop`;
  const recording = [
    `H\t3\t${match}`,
    ...first.fighters.map(
      (row) => `R\t${row.body}\t${row.team}\t${row.kit}\t${row.bot.toString()}`,
    ),
    `N\t0\tx\t0\t0\t0\tfalse\tfalse\t1\t0\t0\tMISSING`,
    `X\t12\t-\tSTOPPED`,
  ].join("\n");
  return { rows, boundary, settlement, log, recording };
}
