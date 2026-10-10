import { z } from "zod";
import { botRecording } from "./recording.ts";
import { type NativeCommand, nativeCommands } from "./console.ts";
import { MeleeProbe, type MeleeBody } from "./melee-wire.ts";
import meleeWire from "#learning-melee-wire";
import {
  RegressionCommand,
  regressionJournal,
} from "#learning/native/regression-gate.ts";

type Journal = ReturnType<typeof regressionJournal>;
export const MeleeIdentity = z.strictObject({
  schema: z.literal(1),
  source: z.literal("automated-regression-console"),
  humanDemonstration: z.literal(false),
  match: z.uuid(),
  attacker: z.uuid(),
  victim: z.uuid(),
});
export type MeleeIdentity = z.infer<typeof MeleeIdentity>;

export function meleeRequests(identity: MeleeIdentity) {
  const { attacker, victim } = identity;
  return [
    ["showcase", "rwf admin showcase 16"],
    ["live-status", "rwf admin status"],
    ["blocked", `rwfmeleeregression blocked ${attacker} ${victim}`],
    ["clear", `rwfmeleeregression clear ${attacker} ${victim}`],
    ["end-status", "rwf admin status"],
  ] as const;
}

function roster(measured: Journal, identity: MeleeIdentity) {
  const first = measured.transitions.find((row) => row.phase === "LIVE");
  const attacker = first?.fighters.find((row) => row.kit === "trooper");
  const victim = first?.fighters.find(
    (row) => row.kit === "trooper" && row.team !== attacker?.team,
  );
  if (
    first?.fighters.length !== 16 ||
    first.fighters.some((row) => !row.bot || !row.alive) ||
    attacker?.body !== identity.attacker ||
    victim?.body !== identity.victim ||
    identity.match !== measured.match ||
    measured.counts.applied === 0 ||
    !measured.transitions.some((row) => row.phase === "ENDED") ||
    measured.transitions.some((row) => row.event === "Stop")
  )
    throw new Error(
      "Melee needs its original normal all-bot roster and applied Java controls",
    );
  return first;
}

function requests(rows: NativeCommand[], identity: MeleeIdentity) {
  if (
    JSON.stringify(rows.map((row) => [row.key, row.command])) !==
    JSON.stringify(meleeRequests(identity))
  )
    throw new Error("Melee requests differ from the original fixed case");
  const indexed = new Map(rows.map((row) => [row.key, row]));
  const get = (key: string) => {
    const row = indexed.get(key);
    if (row === undefined)
      throw new Error(`Original melee request missing: ${key}`);
    return row;
  };
  for (const row of rows.slice(1, 4))
    if (row.startPhase !== "LIVE" || row.endPhase !== "LIVE")
      throw new Error("Melee challenge belongs to another original phase");
  if (
    !get("live-status").response.includes(
      `Match ${identity.match}, map training-yard, 0 humans, 16 bots`,
    ) ||
    [get("end-status").startPhase, get("end-status").endPhase].some(
      (phase) => !["ENDED", "RESETTING", "LOBBY"].includes(phase),
    )
  )
    throw new Error(
      "Melee lacks its original native roster or normal ending checkpoint",
    );
  return get;
}

function bodyPose(body: MeleeBody, expected: { id: string; point: number[] }) {
  const point = [body.x, body.y, body.z, body.yaw, body.pitch];
  if (
    body.body !== expected.id ||
    JSON.stringify(point) !== JSON.stringify(expected.point) ||
    body.gameMode !== "SURVIVAL" ||
    body.invulnerable ||
    body.heldSlot !== 1 ||
    body.weapon !== "IRON_SWORD" ||
    body.knockbackLevel !== 0 ||
    body.absorption !== 0
  )
    throw new Error(
      "Native melee body identity, contact, equipment or immunity changed",
    );
}

function trial(row: NativeCommand, identity: MeleeIdentity) {
  const probe = MeleeProbe.parse(JSON.parse(row.response.trim()));
  if (
    probe.match !== identity.match ||
    probe.trial !== row.key ||
    !probe.reachable
  )
    throw new Error(
      "Native melee probe differs from its original match or reachable trial",
    );
  for (const body of [probe.attackerBefore, probe.attackerAfter])
    bodyPose(body, { id: identity.attacker, point: meleeWire.attacker });
  for (const body of [probe.victimBefore, probe.victimAfter])
    bodyPose(body, { id: identity.victim, point: meleeWire.victim });
  const air = ["minecraft:air", "minecraft:air"];
  const during =
    probe.trial === "blocked" ? ["minecraft:stone", "minecraft:stone"] : air;
  if (
    JSON.stringify(probe.wallBefore) !== JSON.stringify(air) ||
    JSON.stringify(probe.wallAfter) !== JSON.stringify(air) ||
    JSON.stringify(probe.wallDuring) !== JSON.stringify(during) ||
    [probe.attackerBefore, probe.victimBefore].some(
      (body) =>
        body.velocityX !== 0 || body.velocityY !== 0 || body.velocityZ !== 0,
    )
  )
    throw new Error(
      "Native melee wall restoration or initial velocity changed",
    );
  return probe;
}

function blockedTrial(
  probe: MeleeProbe,
  row: NativeCommand,
  measured: Journal,
) {
  if (
    probe.visible ||
    probe.refusal !== "NO_LINE_OF_SIGHT" ||
    JSON.stringify(probe.attackerBefore) !==
      JSON.stringify(probe.attackerAfter) ||
    JSON.stringify(probe.victimBefore) !== JSON.stringify(probe.victimAfter) ||
    measured.damage.some(
      (hit) =>
        hit.sequence > row.startSequence &&
        hit.sequence <= row.endSequence &&
        hit.attacker === probe.attackerBefore.body &&
        hit.victim === probe.victimBefore.body,
    )
  )
    throw new Error(
      "Blocked native melee damaged or moved its target instead of refusing LOS",
    );
}

function clearTrial(probe: MeleeProbe, row: NativeCommand, measured: Journal) {
  const before = probe.victimBefore;
  const after = probe.victimAfter;
  const level =
    probe.attackerBefore.knockbackLevel +
    Number(probe.attackerBefore.sprinting);
  const expected = [0.4 + level / 2, 0.4 + (level > 0 ? 0.1 : 0), 0];
  const velocity = [after.velocityX, after.velocityY, after.velocityZ];
  const hits = measured.damage.filter(
    (hit) =>
      hit.sequence > row.startSequence &&
      hit.sequence <= row.endSequence &&
      hit.attacker === probe.attackerBefore.body &&
      hit.victim === before.body,
  );
  const hit = hits[0];
  if (hit === undefined || hits.length !== 1)
    throw new Error(
      "Clear native melee needs exactly one original hit in its command window",
    );
  if (
    !probe.visible ||
    probe.attackerAfter.sprinting ||
    probe.refusal !== "" ||
    hit.cause !== "ENTITY_ATTACK" ||
    !hit.cancelled ||
    hit.serverTick !== probe.serverTick ||
    before.health <= after.health ||
    Math.abs(hit.before - before.health) > 1e-6 ||
    Math.abs(hit.after - after.health) > 1e-6 ||
    JSON.stringify([hit.velocityX, hit.velocityY, hit.velocityZ]) !==
      JSON.stringify(velocity) ||
    velocity.some(
      (value, i) => Math.abs(value - z.number().parse(expected[i])) > 1e-7,
    )
  )
    throw new Error(
      "Clear native melee lacks actual damage and the rules' away/up knockback in its exact window",
    );
  return { damage: before.health - after.health, velocity };
}

function javaKnockback(measured: Journal, rows: NativeCommand[]) {
  const attacks = measured.actions.filter(
    (row) => row.decision === "applied" && row.ticket?.action.attack === true,
  );
  const hits = measured.damage.filter(
    (hit) =>
      hit.before > hit.after &&
      hit.cause === "ENTITY_ATTACK" &&
      hit.cancelled &&
      Math.hypot(hit.velocityX, hit.velocityZ) >= 0.1 &&
      hit.velocityY >= 0.1 &&
      !rows.some(
        (row) =>
          ["blocked", "clear"].includes(row.key) &&
          hit.sequence > row.startSequence &&
          hit.sequence <= row.endSequence,
      ) &&
      attacks.some(
        (action) =>
          action.body === hit.attacker &&
          action.targetBody === hit.victim &&
          action.serverTick === hit.serverTick &&
          action.sequence < hit.sequence,
      ),
  );
  if (hits.length === 0)
    throw new Error(
      "Melee lacks actual knockback from its original applied Java sword commands",
    );
  return {
    confirmedJavaHits: hits.length,
    actualJavaDamage: hits.reduce(
      (sum, row) => sum + row.before - row.after,
      0,
    ),
  };
}

function originalRecording(
  recording: string,
  measured: Journal,
  fighters: Journal["transitions"][number]["fighters"],
) {
  const { members, endings } = botRecording(recording, measured.match);
  const ended = measured.transitions.find((row) => row.phase === "ENDED");
  const expected = fighters
    .map((row) => `${row.team.toUpperCase()}\t${row.kit}\ttrue`)
    .sort();
  if (
    ended === undefined ||
    endings.length !== 1 ||
    new Set(members.map((row) => row[1])).size !== 16 ||
    members.some((row) => !/^p[a-f0-9]{16}$/u.test(row[1] ?? "")) ||
    JSON.stringify(members.map((row) => row.slice(2).join("\t")).sort()) !==
      JSON.stringify(expected) ||
    endings[0]?.[2] !==
      (ended.winner === "" ? "-" : ended.winner.toUpperCase()) ||
    endings[0][3] !== (ended.winner === "" ? "DRAW" : "LAST_TEAM_STANDING")
  )
    throw new Error("Melee lacks its original normal all-bot recording");
}

/** Original blocked/clear native rules plus applied Java knockback, with no fabricated pass summary. */
export function nativeMelee(evidence: {
  commands: unknown;
  native: unknown;
  identity: unknown;
  recording: string;
}) {
  const commands = z.array(RegressionCommand).parse(evidence.commands);
  const measured = regressionJournal(commands, "native-los-and-knockback");
  const identity = MeleeIdentity.parse(evidence.identity);
  const first = roster(measured, identity);
  const rows = nativeCommands(
    evidence.native,
    commands,
    measured.match,
    "native-los-and-knockback",
  );
  const get = requests(rows, identity);
  const blocked = trial(get("blocked"), identity);
  const clear = trial(get("clear"), identity);
  if (
    clear.serverTick < blocked.serverTick ||
    clear.victimBefore.health !== blocked.victimAfter.health
  )
    throw new Error("Original melee trial order or health continuity changed");
  blockedTrial(blocked, get("blocked"), measured);
  const direct = clearTrial(clear, get("clear"), measured);
  const java = javaKnockback(measured, rows);
  originalRecording(evidence.recording, measured, first.fighters);
  return {
    measured,
    melee: {
      attacker: identity.attacker,
      victim: identity.victim,
      blockedRefusal: blocked.refusal,
      blockedDamage: 0,
      clearDamage: direct.damage,
      clearVelocity: direct.velocity,
      ...java,
      restoredWallCells: 2,
    },
  };
}
