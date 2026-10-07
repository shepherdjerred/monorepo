import { meleeFixture } from "./melee-fixture.ts";
import { teamRequests } from "./team-gate.ts";
import { teamPseudonym } from "./team-recording.ts";
import type { NativeCommand } from "./console.ts";
import type { RegressionCommand } from "#learning/native/regression-gate.ts";

/** Synthetic boundaries only; these paths never establish native or training evidence. */
function nativeTicks(source: ReturnType<typeof meleeFixture>) {
  let sequence = 3;
  const ticks = [];
  for (let tick = 101; tick <= 400; tick++) {
    if (tick === 320) {
      source.applied.sequence = ++sequence;
      source.applied.serverTick = tick;
      source.applied.botTick = tick - 90;
      if (source.applied.ticket === null)
        throw new Error("Synthetic team ticket missing");
      source.applied.ticket.tick = tick - 91;
      source.hit.sequence = ++sequence;
      source.hit.serverTick = tick;
    }
    if (tick === 400) sequence++;
    ticks.push({
      sequence: ++sequence,
      serverTick: tick,
      botTick: tick - 90,
      milliseconds: 12,
      live: true,
      batchRows: tick === 320 ? 1 : 0,
    });
  }
  return { ticks, sequence };
}

export function teamFixture() {
  const source = meleeFixture();
  const initial = source.commands[1]?.state;
  const live = source.commands[2]?.state;
  const final = source.commands[4]?.state;
  const first = live?.transitions[0];
  if (
    initial === undefined ||
    live === undefined ||
    final === undefined ||
    first === undefined
  )
    throw new Error("Synthetic team journal prerequisite missing");
  const fighters = first.fighters;
  const caseName = "native-team-advancement";
  const { ticks, sequence } = nativeTicks(source);
  const ended: RegressionCommand["state"]["transitions"][number] = {
    ...first,
    sequence: sequence - 1,
    serverTick: 400,
    phase: "ENDED",
    event: "Tick",
    winner: "red",
    fighters: fighters.map((row) => ({ ...row, alive: row.team === "red" })),
  };
  const commands: RegressionCommand[] = [
    { command: "load", state: { ...initial, match: "", caseName: "" } },
    { command: `arm ${caseName} 16`, state: { ...initial, caseName } },
    { command: "sample", state: { ...live, caseName } },
    {
      command: "sample",
      state: {
        ...final,
        caseName,
        sequence,
        actions: [source.applied],
        damage: [source.hit],
        ticks,
        transitions: [ended],
      },
    },
    {
      command: "release",
      state: {
        ...initial,
        caseName,
        sequence,
        phase: "ENDED",
        result: "released",
        inference: final.inference,
      },
    },
  ];
  const context = {
    match: initial.match,
    fighters,
    duration: 300,
    winner: "red",
  };
  const native: NativeCommand[] = teamRequests.map(([key, command], i) => ({
    key,
    command,
    sequence: i + 1,
    response:
      i === 1
        ? `Match ${initial.match}, map training-yard, 0 humans, 16 bots`
        : "",
    startSequence: i === 0 ? 0 : i === 1 ? 3 : sequence,
    endSequence: i === 2 ? sequence : 3,
    startPhase: i === 0 ? "LOBBY" : i === 1 ? "LIVE" : "ENDED",
    endPhase: i === 2 ? "ENDED" : "LIVE",
  }));
  const rows = [
    [
      "H",
      "3",
      initial.match,
      "training-yard",
      "a".repeat(64),
      "10",
      "rwf-combat-1",
    ],
    ...fighters.map((row) => [
      "R",
      teamPseudonym(row.body),
      row.team.toUpperCase(),
      row.kit,
      "true",
    ]),
  ];
  for (let tick = 0; tick <= 300; tick += 2) {
    if (tick === 220)
      rows.push([
        "I",
        "220",
        teamPseudonym(source.identity.attacker),
        "attack",
        teamPseudonym(source.identity.victim),
      ]);
    for (const [i, row] of fighters.entries()) {
      const delta = Math.min(tick / 6, 28);
      const x = row.team === "red" ? 4 + delta : 60 - delta;
      rows.push([
        "F",
        tick.toString(),
        teamPseudonym(row.body),
        Math.round(x * 32).toString(),
        "2080",
        ((Math.floor(i / 2) * 4 + 8) * 32).toString(),
        "0",
        "0",
        "80",
        "1",
        "0",
      ]);
    }
  }
  rows.push(["X", "300", "RED", "LAST_TEAM_STANDING"]);
  return {
    commands,
    native,
    context,
    rows,
    recording: rows.map((row) => row.join("\t")).join("\n") + "\n",
  };
}
