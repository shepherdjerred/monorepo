import { z } from "zod";
import { botRecording } from "./recording.ts";
import { type NativeCommand, nativeCommands } from "./console.ts";
import {
  RegressionCommand,
  regressionJournal,
} from "#learning/native/regression-gate.ts";
import { EntityPosOutputSchema } from "#e2e/harness/rcon-output.ts";

export const WatcherIdentity = z.strictObject({
  schema: z.literal(1),
  source: z.literal("automated-regression-client"),
  command: z.literal("/rwf spectate"),
  humanDemonstration: z.literal(false),
  match: z.uuid(),
  watcher: z.uuid(),
  name: z.literal("RwfSpectator"),
  attacker: z.uuid(),
  victim: z.uuid(),
});
export type WatcherIdentity = z.infer<typeof WatcherIdentity>;
type Journal = ReturnType<typeof regressionJournal>;

/** Fixed original requests; no speculative damage response can substitute for measured health. */
export function watcherRequests(identity: WatcherIdentity) {
  const { name, watcher, attacker, victim } = identity;
  const mode = `execute if entity @a[name=${name},gamemode=spectator]`;
  const healthCommand = `data get entity ${name} Health`;
  const damage = `damage ${name} 4 minecraft:player_attack by ${attacker}`;
  return [
    ["showcase", "rwf admin showcase 16"],
    ["live-status", "rwf admin status"],
    ["watcher-present", `execute if entity ${watcher}`],
    ["spectator-mode", mode],
    ["contact-teleport", `execute at ${attacker} run tp ${name} ~ ~ ~`],
    ["watcher-position", `data get entity ${name} Pos`],
    ["attacker-position", `data get entity ${attacker} Pos`],
    ["watcher-health-before", healthCommand],
    ["watcher-damage-1", damage],
    ["watcher-damage-2", damage],
    ["watcher-damage-3", damage],
    ["watcher-health-after", healthCommand],
    ["fighter-health-before", `data get entity ${victim} Health`],
    [
      "fighter-damage",
      `damage ${victim} 4 minecraft:player_attack by ${attacker}`,
    ],
    ["fighter-health-after", `data get entity ${victim} Health`],
    ["end-status", "rwf admin status"],
    ["end-watcher-present", `execute if entity ${watcher}`],
    ["end-spectator-mode", mode],
    ["end-watcher-health", healthCommand],
  ] as const;
}

function health(response: string, expectedName?: string) {
  const match =
    /^(?<name>\w+) has the following entity data: (?<health>\d+(?:\.\d+)?)f$/u.exec(
      response.trim(),
    );
  const parsed = z
    .object({ name: z.string(), health: z.coerce.number().min(0).max(20) })
    .parse(match?.groups);
  if (expectedName !== undefined && parsed.name !== expectedName)
    throw new Error("Native health probe belongs to another watcher");
  return parsed.health;
}

function roster(measured: Journal, identity: WatcherIdentity) {
  const first = measured.transitions.find((row) => row.phase === "LIVE");
  const attacker = first?.fighters.find(
    (row) => row.body === identity.attacker,
  );
  const victim = first?.fighters.find((row) => row.body === identity.victim);
  if (
    first?.fighters.length !== 16 ||
    first.fighters.some((row) => !row.bot || !row.alive) ||
    attacker?.kit !== "trooper" ||
    victim?.alive !== true ||
    attacker.team === victim.team ||
    measured.match !== identity.match ||
    measured.counts.applied === 0
  )
    throw new Error(
      "Spectator check lacks its original all-bot roster and applied Java controls",
    );
  if (
    measured.transitions.some((row) =>
      row.fighters.some(
        (fighter) => fighter.body === identity.watcher || !fighter.bot,
      ),
    ) ||
    measured.actions.some(
      (row) =>
        row.body === identity.watcher || row.targetBody === identity.watcher,
    ) ||
    measured.damage.some(
      (row) => row.victim === identity.watcher && row.before > row.after,
    ) ||
    !measured.transitions.some((row) => row.phase === "ENDED")
  )
    throw new Error(
      "Spectator joined combat, became a target, lost health or lacked an original ending",
    );
}

function requestRows(rows: NativeCommand[], identity: WatcherIdentity) {
  const expected = watcherRequests(identity);
  if (
    JSON.stringify(rows.map((row) => [row.key, row.command])) !==
    JSON.stringify(expected)
  )
    throw new Error(
      "Spectator native requests differ from the fixed original challenge",
    );
  const indexed = new Map(rows.map((row) => [row.key, row]));
  const get = (key: string) => {
    const row = indexed.get(key);
    if (row === undefined)
      throw new Error(`Original spectator request missing: ${key}`);
    return row;
  };
  for (const row of rows.slice(1, 15)) {
    if (row.startPhase !== "LIVE" || row.endPhase !== "LIVE")
      throw new Error("Spectator challenge belongs to another original phase");
  }
  for (const row of rows.slice(15)) {
    if (
      [row.startPhase, row.endPhase].some(
        (phase) => !["ENDED", "RESETTING", "LOBBY"].includes(phase),
      )
    )
      throw new Error("Spectator terminal probe preceded the original ending");
  }
  for (const key of [
    "watcher-present",
    "spectator-mode",
    "end-watcher-present",
    "end-spectator-mode",
  ])
    if (get(key).response.trim() !== "Test passed. Count: 1")
      throw new Error("Spectator lost native presence or spectator mode");
  for (const key of [
    "watcher-damage-1",
    "watcher-damage-2",
    "watcher-damage-3",
    "fighter-damage",
  ])
    if (
      get(key).response.trim() !==
      "Target is invulnerable to the given damage type"
    )
      throw new Error(
        "Native damage response differs from its original challenge",
      );
  if (
    !get("live-status").response.includes(
      `Match ${identity.match}, map training-yard, 0 humans, 16 bots`,
    ) ||
    !get("live-status").response.includes("Watchers: 1, showcase: yes") ||
    !get("end-status").response.includes("Watchers: 1,")
  )
    throw new Error(
      "Native spectator status differs from the original showcase",
    );
  return get;
}

function spectatorContact(
  get: (key: string) => NativeCommand,
  identity: WatcherIdentity,
) {
  const watcher = EntityPosOutputSchema.parse(get("watcher-position").response);
  const attacker = EntityPosOutputSchema.parse(
    get("attacker-position").response,
  );
  if (
    watcher.entity !== identity.name ||
    Math.hypot(
      watcher.x - attacker.x,
      watcher.y - attacker.y,
      watcher.z - attacker.z,
    ) > 1.75
  )
    throw new Error("Spectator challenge lacks original native contact");
  const before = health(get("watcher-health-before").response, identity.name);
  const after = health(get("watcher-health-after").response, identity.name);
  const end = health(get("end-watcher-health").response, identity.name);
  if (before !== 20 || after !== before || end !== before)
    throw new Error(
      "Spectator native health changed during or after the challenge",
    );
  return before;
}

function positiveControl(
  get: (key: string) => NativeCommand,
  identity: WatcherIdentity,
  measured: Journal,
) {
  const command = get("fighter-damage");
  const before = health(get("fighter-health-before").response);
  const after = health(get("fighter-health-after").response);
  const damage = measured.damage.filter(
    (row) =>
      row.sequence > command.startSequence &&
      row.sequence <= command.endSequence &&
      row.attacker === identity.attacker &&
      row.victim === identity.victim &&
      row.cause === "ENTITY_ATTACK" &&
      row.cancelled &&
      row.before > row.after,
  );
  const hit = damage[0];
  if (
    hit === undefined ||
    damage.length !== 1 ||
    before <= after ||
    Math.abs(before - hit.before) > 0.001 ||
    Math.abs(after - hit.after) > 0.001
  )
    throw new Error(
      "Spectator positive control lacks actual native fighter damage in the exact command window",
    );
  return hit.before - hit.after;
}

function originalRecording(recording: string, measured: Journal) {
  const { members, endings } = botRecording(recording, measured.match);
  const ending = endings[0];
  const ended = measured.transitions.find((row) => row.phase === "ENDED");
  if (
    ended === undefined ||
    members.some((row) => row[4] !== "true") ||
    endings.length !== 1 ||
    ending?.[2] !== (ended.winner === "" ? "-" : ended.winner.toUpperCase()) ||
    ending[3] !== (ended.winner === "" ? "DRAW" : "LAST_TEAM_STANDING")
  )
    throw new Error(
      "Spectator check lacks its original normal all-bot recording and ending",
    );
}

/** Replay original native health and target evidence; a damage-command error alone proves nothing. */
export function spectatorImmunity(evidence: {
  commands: unknown;
  native: unknown;
  identity: unknown;
  recording: string;
}) {
  const commands = z.array(RegressionCommand).parse(evidence.commands);
  const measured = regressionJournal(commands, "spectator-immunity");
  const identity = WatcherIdentity.parse(evidence.identity);
  roster(measured, identity);
  const rows = nativeCommands(
    evidence.native,
    commands,
    measured.match,
    "spectator-immunity",
  );
  const get = requestRows(rows, identity);
  const watcherHealth = spectatorContact(get, identity);
  const nativeFighterDamage = positiveControl(get, identity, measured);
  originalRecording(evidence.recording, measured);
  return {
    measured,
    spectator: {
      watcher: identity.watcher,
      damageChallenges: 3,
      watcherHealth,
      nativeFighterDamage,
      selectedAsTarget: false,
      remainedSpectatorThroughEnd: true,
    },
  };
}
