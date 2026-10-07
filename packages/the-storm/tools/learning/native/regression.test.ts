import { describe, expect, it } from "vitest";
import { RegressionSample } from "./regression-client.ts";
import { regressionJournal } from "./regression-gate.ts";
import { humanCombat } from "./regression/human-gate.ts";
import { lastHumanAbort } from "./regression/abort-gate.ts";
import {
  journal,
  terminal,
  selected,
  humanJournal,
  abortJournal,
} from "#learning/native/evidence/test-support/player-fixture.ts";

const match = "11111111-1111-4111-8111-111111111111";
const body = "22222222-2222-4222-8222-222222222222";
const opponent = "33333333-3333-4333-8333-333333333333";
const caseName = "native-team-advancement";

describe("original last-human disconnect", () => {
  it("recounts last-human abort from the original disconnect, native entities and persisted zero-credit result", () => {
    const { rows, boundary, settlement, log, recording } = abortJournal();
    expect(
      lastHumanAbort({ commands: rows, boundary, settlement, log, recording })
        .abort,
    ).toEqual({
      player: opponent,
      botsDespawned: 7,
      ticksToStop: 1,
      result: "STOPPED",
      creditsOwed: 0,
      creditsPaid: 0,
    });
  });

  it.each([
    "disconnect",
    "stop",
    "body",
    "count",
    "probe",
    "checkpoint",
    "grace",
    "player",
    "credit",
    "winner",
    "recording",
    "input",
  ])("rejects last-human abort with altered %s evidence", (edit) => {
    const value = abortJournal();
    const { rows, boundary, settlement } = value;
    const left = rows[3]?.state.transitions[0];
    const stop = rows[4]?.state.transitions[0];
    const probe = boundary.departed.probes[0];
    const player = settlement.players[0];
    if (
      left === undefined ||
      stop === undefined ||
      probe === undefined ||
      player === undefined
    )
      throw new Error("synthetic abort mutation missing");
    if (edit === "disconnect") left.event = "Leave";
    if (edit === "stop") stop.event = "Tick";
    if (edit === "body") probe.response = "Test passed. Count: 1";
    if (edit === "count") probe.response = "Test passed. Count: 2";
    if (edit === "probe") probe.command = `execute if entity ${match}`;
    if (edit === "checkpoint") boundary.departed.startSequence = 4;
    if (edit === "grace") value.log = value.log.replace("PT5S", "PT1S");
    if (edit === "player") player.player = body;
    if (edit === "credit") player.credits_owed = 3;
    if (edit === "winner") stop.winner = "red";
    if (edit === "recording")
      value.recording = value.recording.replace("STOPPED", "ELIMINATION");
    if (edit === "input")
      value.recording = value.recording.replace("MISSING", "HUMAN");
    expect(() =>
      lastHumanAbort({
        commands: rows,
        boundary,
        settlement,
        log: value.log,
        recording: value.recording,
      }),
    ).toThrow();
  });
});

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
