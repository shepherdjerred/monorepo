import { z } from "zod";
import { nativeCommands } from "./console.ts";
import {
  teamRecording,
  teamPseudonym,
  type TeamContext,
} from "./team-recording.ts";
import {
  RegressionCommand,
  regressionJournal,
} from "#learning/native/regression-gate.ts";
import { contract, Proof } from "#learning/promotion/contract.ts";
import { advance, dispersion } from "#e2e/harness/rwf-trails.ts";

export const teamRequests = [
  ["showcase", "rwf admin showcase 16"],
  ["live-status", "rwf admin status"],
  ["end-status", "rwf admin status"],
] as const;

/** Same metrics, windows and per-team floors as the existing full native showcase gate. */
export function teamMovement(recording: string, context: TeamContext) {
  const { trails, completeness, attacks } = teamRecording(recording, context);
  const contact = z.number().positive().parse(trails.firstContact);
  const spacing = dispersion(trails, { from: 0, until: contact });
  const at8 = advance(trails, { at: 160, until: contact });
  const atContact = advance(trails, { at: contact, until: contact });
  const by10 = advance(trails, { at: 200, until: 200 });
  for (const rows of [spacing, at8, atContact, by10])
    if (JSON.stringify(rows.map((row) => row.team)) !== '["BLUE","RED"]')
      throw new Error("Team movement lacks both original measured sides");
  const nativeFloors = Proof.shape.regressions.shape.native_floors.parse({
    bots: 16,
    minimum_spacing: Math.min(...spacing.map((row) => row.nearestP50)),
    minimum_width_at_8: Math.min(...at8.map((row) => row.spreadAt)),
    minimum_width_at_contact: Math.min(...atContact.map((row) => row.spreadAt)),
    minimum_forward: Math.min(...by10.map((row) => row.forward)),
    maximum_winding: Math.max(...atContact.map((row) => row.winding)),
  });
  if (spacing.some((row) => row.samples === 0))
    throw new Error("Team movement lacks original spacing samples");
  return {
    nativeFloors,
    spacing,
    at8,
    atContact,
    by10,
    contact,
    attacks,
    ...completeness,
  };
}

/** Native controls and original complete paths, rather than an aggregate pass declaration. */
export function nativeTeam(evidence: {
  commands: unknown;
  native: unknown;
  recording: string;
}) {
  const caseName = "native-team-advancement";
  const commands = z.array(RegressionCommand).parse(evidence.commands);
  const measured = regressionJournal(commands, caseName);
  const first = measured.transitions.find((row) => row.phase === "LIVE");
  const ended = measured.transitions.find((row) => row.phase === "ENDED");
  if (
    first === undefined ||
    ended === undefined ||
    first.fighters.length !== 16 ||
    first.fighters.some((row) => !row.bot || !row.alive) ||
    ["red", "blue"].some(
      (team) => first.fighters.filter((row) => row.team === team).length !== 8,
    ) ||
    measured.transitions.some((row) => row.event === "Stop") ||
    measured.counts.applied === 0 ||
    measured.damageEvents === 0
  )
    throw new Error(
      "Team advancement needs its normal sixteen-bot native match, Java controls and damage",
    );
  const rows = nativeCommands(
    evidence.native,
    commands,
    measured.match,
    caseName,
  );
  if (
    JSON.stringify(rows.map((row) => [row.key, row.command])) !==
    JSON.stringify(teamRequests)
  )
    throw new Error("Team native requests differ from the original fixed case");
  const live = rows[1];
  const end = rows[2];
  if (
    end === undefined ||
    live?.startPhase !== "LIVE" ||
    live.endPhase !== "LIVE" ||
    !live.response.includes(
      `Match ${measured.match}, map training-yard, 0 humans, 16 bots`,
    ) ||
    [end.startPhase, end.endPhase].some(
      (phase) => !["ENDED", "RESETTING", "LOBBY"].includes(phase),
    )
  )
    throw new Error(
      "Team advancement lacks its original native roster and normal ending checkpoints",
    );
  const movement = teamMovement(evidence.recording, {
    match: measured.match,
    fighters: first.fighters,
    duration: ended.serverTick - first.serverTick,
    winner: ended.winner,
  });
  if (
    movement.attacks.length === 0 ||
    movement.attacks.some(
      (attack) =>
        !measured.damage.some(
          (hit) =>
            hit.cause === "ENTITY_ATTACK" &&
            hit.cancelled &&
            hit.serverTick - first.serverTick === attack.tick &&
            teamPseudonym(hit.attacker) === attack.attacker &&
            teamPseudonym(hit.victim) === attack.victim,
        ),
    )
  )
    throw new Error(
      "Team recording attack differs from the original native damage journal",
    );
  return { measured, movement, floors: contract.nativeFloors };
}
