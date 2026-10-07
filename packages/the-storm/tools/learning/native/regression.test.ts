import { describe, expect, it } from "vitest";
import { RegressionSample } from "./regression-client.ts";
import {
  regressionJournal,
  type RegressionCommand,
} from "./regression-gate.ts";
import { humanCombat } from "./regression/human-gate.ts";

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
function journal(): RegressionCommand[] {
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

function terminal(rows: RegressionCommand[]) {
  const state = rows.at(-1)?.state;
  if (state === undefined) throw new Error("synthetic terminal is missing");
  return state;
}

function selected(rows: RegressionCommand[]) {
  const action = terminal(rows).actions[1];
  const ticket = action?.ticket;
  if (ticket === undefined || ticket === null || action === undefined)
    throw new Error("synthetic ticket is missing");
  return { action, ticket };
}

function humanJournal() {
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

describe("original native regression journal", () => {
  it("requires the current target/probe wire instead of silently accepting old capture rows", () => {
    const rows = journal();
    expect(() =>
      RegressionSample.parse({
        ...rows[0]?.state,
        protocol: 1,
        contract: "rwf-regression-capture-v1",
      }),
    ).toThrow();
    const { action } = selected(rows);
    action.targetBody = "55555555-5555-4555-8555-555555555555";
    expect(() => regressionJournal(rows, caseName)).toThrow(/target body/u);
  });

  it("binds actual player damage to an original applied Java attack and vulnerable contact", () => {
    const result = humanCombat(
      regressionJournal(humanJournal(), "human-combat"),
    );
    expect(result).toEqual({
      player: opponent,
      contactProbes: 1,
      appliedPlayerAttacks: 1,
      confirmedPlayerHits: 1,
      actualPlayerDamage: 2,
    });
  });

  it.each([
    "spectator",
    "invulnerable",
    "foreign",
    "distance",
    "target",
    "victim",
    "clock",
    "unapplied",
  ])("rejects player combat with %s evidence", (edit) => {
    const rows = humanJournal();
    const state = terminal(rows);
    const probe = state.probes[0];
    const damage = state.damage[0];
    if (probe === undefined || damage === undefined)
      throw new Error("synthetic human proof missing");
    if (edit === "spectator") probe.gameMode = "SPECTATOR";
    if (edit === "invulnerable") probe.invulnerable = true;
    if (edit === "foreign") probe.player = body;
    if (edit === "distance") probe.playerZ = 7;
    if (edit === "target") selected(rows).action.targetBody = body;
    if (edit === "victim") damage.victim = body;
    if (edit === "clock") damage.serverTick = 100;
    if (edit === "unapplied") {
      const { action } = selected(rows);
      action.decision = "unavailable";
      action.ticket = null;
      action.commands = [...action.authored];
    }
    expect(() =>
      humanCombat(regressionJournal(rows, "human-combat")),
    ).toThrow();
  });
  it("recounts selections, cancelled native damage and terminal interrupted batches", () => {
    const measured = regressionJournal(journal(), caseName);
    expect(measured.counts).toEqual({
      "authored-kit": 0,
      ineligible: 0,
      unavailable: 1,
      applied: 1,
    });
    expect(measured.appliedAges).toEqual([0, 1, 0]);
    expect(measured.damageAmount).toBe(2);
    expect(measured.batchRows).toBe(1);
  });

  it.each(["match", "body", "life", "old", "future"])(
    "rejects a foreign %s ticket",
    (change) => {
      const rows = journal();
      const { ticket } = selected(rows);
      if (change === "match") ticket.match = opponent;
      if (change === "body") ticket.body = opponent;
      if (change === "life") ticket.life = 2;
      if (change === "old") ticket.tick = 8;
      if (change === "future") ticket.tick = 12;
      expect(() => regressionJournal(rows, caseName)).toThrow(
        /identity or age/u,
      );
    },
  );

  it("rejects selected controls for another kit or an invisible target", () => {
    for (const edit of ["kit", "target"]) {
      const rows = journal();
      const { action } = selected(rows);
      if (edit === "kit") action.kit = "LONGBOW";
      else {
        action.targetId = null;
        action.targetBody = null;
      }
      expect(() => regressionJournal(rows, caseName)).toThrow(
        /roster|eligibility/u,
      );
    }
  });

  it("requires the sword command to preserve the original authored target identity", () => {
    for (const command of [
      "Attack[target=#3]",
      "Attack[target=CombatantId[value=2]]",
    ]) {
      const rows = journal();
      const { action } = selected(rows);
      action.commands[action.commands.length - 1] = command;
      expect(() => regressionJournal(rows, caseName)).toThrow(/sword action/u);
    }
  });

  it("rejects changes to authored aim, fallback and submitted action heads", () => {
    for (const edit of ["aim", "fallback", "sneak", "move"]) {
      const rows = journal();
      const { action, ticket } = selected(rows);
      if (edit === "aim") action.commands[0] = "Look[yaw=90.0, pitch=0.0]";
      if (edit === "sneak") ticket.action.sneak = true;
      if (edit === "move") ticket.action.move = 7;
      if (edit === "fallback")
        terminal(rows).actions[0]?.commands.push("Jump[]");
      expect(() => regressionJournal(rows, caseName)).toThrow();
    }
  });

  it("recomputes movement in the original ticket yaw frame", () => {
    const rows = journal();
    const { action, ticket } = selected(rows);
    ticket.yaw = 90;
    ticket.action.move = 7;
    ticket.action.sprint = true;
    action.commands[1] =
      "MoveToward[waypoint=Vec3[x=1.0, y=65.0, z=3.0], sprint=true]";
    expect(regressionJournal(rows, caseName).counts.applied).toBe(1);
    action.commands[1] =
      "MoveToward[waypoint=Vec3[x=3.0, y=65.0, z=3.0], sprint=true]";
    expect(() => regressionJournal(rows, caseName)).toThrow(/movement/u);
  });

  it("rejects lost, duplicated or clock-shifted original rows", () => {
    for (const edit of ["loss", "duplicate", "clock", "counter"]) {
      const rows = journal();
      const state = terminal(rows);
      if (edit === "loss") state.damage = [];
      if (edit === "duplicate")
        state.damage.push(...structuredClone(state.damage));
      if (edit === "clock") selected(rows).action.botTick = 12;
      if (edit === "counter") state.sequence++;
      expect(() => regressionJournal(rows, caseName)).toThrow(
        /rows|counter|clock/u,
      );
    }
  });

  it("requires original inference counts and a released native terminal", () => {
    for (const edit of ["batch", "pending", "terminal", "reroll"]) {
      const rows = journal();
      const state = terminal(rows);
      if (state.inference === null)
        throw new Error("synthetic counters missing");
      if (edit === "batch") state.inference.submitted = 2;
      if (edit === "pending") state.inference.deadlineMet = 0;
      if (edit === "terminal")
        state.transitions = state.transitions.filter(
          (row) => row.phase === "LIVE",
        );
      if (edit === "reroll") {
        const armed = rows[1];
        if (armed === undefined) throw new Error("synthetic arm is missing");
        rows.splice(2, 0, structuredClone(armed));
      }
      expect(() => regressionJournal(rows, caseName)).toThrow();
    }
  });
});
