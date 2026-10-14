import { z } from "zod";
import wire from "#authored-combat-wire";

const tick = z.number().int().nonnegative();
const difficulty = z.enum(["PEACEFUL", "EASY", "NORMAL", "HARD"]);
const hostDifficulty = z.enum(["EASY", "NORMAL", "HARD"]);
export const AuthoredCombatHost = z.strictObject({
  match: z.uuid(),
  enabled: z.boolean(),
  host: z.uuid().nullable(),
  locked: z.boolean(),
  selectedDifficulty: hostDifficulty,
  currentDifficulty: hostDifficulty,
});
const Levers = z.strictObject({
  reactionMs: z.number().min(150).max(450),
  aimErrorDeg: z.number().min(0.5).max(6),
  turnRateDegPerTick: z.number().min(8).max(45),
  cps: z.number().min(5).max(12),
  predictionQuality: z.number().min(0).max(1),
  decisionTemperature: z.number().min(0.05).max(1),
  awarenessRadius: z.number().min(24).max(64),
  coordination: z.number().min(0).max(1),
  technique: z.number().min(0).max(1),
  aggression: z.number().min(0).max(1),
});
const Style = z.strictObject({
  aggression: z.number().min(0).max(1),
  patience: z.number().min(0).max(1),
  teamplay: z.number().min(0).max(1),
  risk: z.number().min(0).max(1),
});
const Profile = z.strictObject({
  body: z.uuid(),
  personality: z.string().min(1),
  levers: Levers,
  style: Style,
});
export {
  Levers as AuthoredCombatLevers,
  Style as AuthoredCombatStyle,
  Profile as AuthoredCombatProfile,
};
const Effective = z.strictObject({
  host: AuthoredCombatHost,
  profile: Profile,
});
const Actor = z.strictObject({
  body: z.uuid(),
  world: z.uuid(),
  kit: z.string().min(1),
  team: z.string().min(1),
  alive: z.boolean(),
  physicallyAlive: z.boolean(),
  valid: z.boolean(),
  online: z.boolean(),
  mode: z.enum(["SURVIVAL", "ADVENTURE", "CREATIVE", "SPECTATOR"]),
  invulnerable: z.boolean(),
  health: z.number().nonnegative(),
  absorption: z.number().nonnegative(),
  noDamageTicks: tick,
  position: z.tuple([z.number(), z.number(), z.number()]),
  foodLevel: z.number().int().min(0).max(20),
  saturation: z.number().min(0).max(20),
});
const Frame = z.strictObject({
  sequence: tick,
  serverTick: tick,
  match: z.uuid(),
  world: z.uuid(),
  phase: z.enum([
    "LOBBY",
    "COUNTDOWN",
    "PREPARING",
    "PREVIEW",
    "FREEZE",
    "LIVE",
    "ENDED",
    "RESETTING",
  ]),
  difficulty,
  human: Actor,
  bot: Actor,
  effective: Effective,
});
const Hit = z.strictObject({
  sequence: tick,
  cause: z.literal("ENTITY_ATTACK"),
  cancelled: z.boolean(),
  before: Frame,
  monitor: Frame,
  after: Frame,
});
const Environment = z.strictObject({
  originalDifficulty: difficulty,
  currentDifficulty: difficulty,
  restored: z.boolean(),
});
export const AuthoredCombatProbe = z.strictObject({
  ready: z.boolean(),
  message: z.string(),
  frame: Frame,
});
export const AuthoredCombatCapture = z.strictObject({
  version: z.literal(2),
  kind: z.literal("rwf-authored-npc-human-combat"),
  humanDemonstration: z.literal(false),
  authoredBotControl: z.literal(true),
  state: z.enum(["observing", "closed", "failed"]),
  message: z.string(),
  match: z.uuid(),
  world: z.uuid(),
  human: z.uuid(),
  bot: z.uuid(),
  experience: z
    .string()
    .regex(
      /^experience-v1;seed=-?\d+;difficulty=hard;style=varied;variety=high;maps=[a-z0-9,-]*;kits=trooper$/u,
    ),
  effective: Effective,
  startedTick: tick,
  sampledTick: tick,
  dropped: tick,
  pending: tick,
  environment: Environment,
  frames: z.array(Frame).max(4096),
  hits: z.array(Hit).max(4096),
});
export const authoredCombatContract = z
  .strictObject({
    version: z.literal(2),
    kind: z.literal("rwf-authored-npc-human-combat"),
    humanDemonstration: z.literal(false),
    authoredBotControl: z.literal(true),
    maximumTicks: z.literal(1200),
    maximumRows: z.literal(4096),
    records: z.record(z.string(), z.array(z.string())),
  })
  .parse(wire);
const records = {
  Actor,
  Frame,
  Hit,
  Environment,
  Probe: AuthoredCombatProbe,
  Capture: AuthoredCombatCapture,
  Host: AuthoredCombatHost,
  Profile,
  Effective,
  Levers,
  Style,
};
for (const [name, schema] of Object.entries(records))
  if (
    JSON.stringify(authoredCombatContract.records[name]) !==
    JSON.stringify(Object.keys(schema.shape))
  )
    throw new Error(`Authored combat contract differs for ${name}`);
if (
  Object.keys(records).length !==
  Object.keys(authoredCombatContract.records).length
)
  throw new Error("Authored combat contract inventory differs");

type Capture = z.infer<typeof AuthoredCombatCapture>;
type Observation = z.infer<typeof Frame>;
type Receipt = z.infer<typeof Hit>;

/** Evidence for one ordinary authored NPC hurting the original joined SURVIVAL human. */
export function summarizeAuthoredCombat(raw: unknown) {
  const capture = AuthoredCombatCapture.parse(raw);
  validateEffective(capture);
  if (
    capture.state !== "closed" ||
    capture.message !== "" ||
    capture.dropped !== 0 ||
    capture.pending !== 0
  )
    throw new Error("Authored combat observer has no clean terminal capture");
  if (
    !capture.environment.restored ||
    capture.environment.currentDifficulty !==
      capture.environment.originalDifficulty
  )
    throw new Error("Disposable combat world difficulty was not restored");
  if (
    capture.human === capture.bot ||
    capture.frames.length < 2 ||
    capture.hits.length === 0
  )
    throw new Error(
      "Authored combat lacks its original actors, frames or actual melee event",
    );
  const observations = [
    ...capture.frames,
    ...capture.hits.flatMap((hit) => [hit.before, hit.monitor, hit.after]),
  ];
  for (const frame of observations) validateFrame(frame, capture);
  validateOrder(capture, observations);
  for (const hit of capture.hits) validateReceipt(hit);
  const damaging = capture.hits.filter(
    (hit) =>
      hit.cancelled &&
      !hit.before.human.invulnerable &&
      hit.before.human.noDamageTicks === 0 &&
      hit.monitor.human.health < hit.before.human.health &&
      hit.after.human.health < hit.before.human.health,
  );
  if (damaging.length === 0)
    throw new Error(
      "No ordinary NPC melee hit reduced the original vulnerable joined human's HP",
    );
  return {
    kind: capture.kind,
    humanDemonstration: false,
    authoredBotControl: true,
    match: capture.match,
    human: capture.human,
    bot: capture.bot,
    declaredExperience: capture.experience,
    effective: capture.effective,
    nativeMeleeEvents: capture.hits.length,
    damagingMeleeEvents: damaging.length,
    retainedHealthLoss: Math.max(
      ...damaging.map(
        (hit) => hit.before.human.health - hit.after.human.health,
      ),
    ),
    observedTicks: capture.sampledTick - capture.startedTick,
  };
}

function validateFrame(frame: Observation, capture: Capture) {
  validateActor(frame.human, capture.human, capture.world);
  validateActor(frame.bot, capture.bot, capture.world);
  if (
    frame.match !== capture.match ||
    frame.phase !== "LIVE" ||
    frame.world !== capture.world ||
    frame.difficulty !== "HARD" ||
    JSON.stringify(frame.effective) !== JSON.stringify(capture.effective) ||
    frame.human.mode !== "SURVIVAL" ||
    frame.human.team === frame.bot.team ||
    !frame.human.online ||
    frame.serverTick < capture.startedTick ||
    frame.serverTick > capture.sampledTick
  )
    throw new Error(
      "Combat frame left the original opposing living Troopers and SURVIVAL human",
    );
}

function validateEffective(capture: Capture) {
  const { host, profile } = capture.effective;
  if (
    !host.enabled ||
    host.match !== capture.match ||
    host.host !== capture.human ||
    !host.locked ||
    host.selectedDifficulty !== "HARD" ||
    host.currentDifficulty !== "HARD" ||
    profile.body !== capture.bot
  )
    throw new Error(
      "Combat requires the original host's frozen HARD and actual bot profile",
    );
}

function validateActor(
  actor: z.infer<typeof Actor>,
  body: string,
  world: string,
) {
  if (
    actor.body !== body ||
    actor.world !== world ||
    actor.kit !== "trooper" ||
    actor.health > 20 ||
    !actor.alive ||
    !actor.physicallyAlive ||
    !actor.valid
  )
    throw new Error("Original native living Trooper body changed");
}

function validateOrder(capture: Capture, frames: Observation[]) {
  const rows = [
    ...frames,
    ...capture.hits.map((hit) => ({
      sequence: hit.sequence,
      serverTick: hit.after.serverTick,
    })),
  ];
  if (
    capture.sampledTick < capture.startedTick ||
    capture.sampledTick - capture.startedTick >
      authoredCombatContract.maximumTicks ||
    new Set(rows.map((row) => row.sequence)).size !== rows.length
  )
    throw new Error(
      "Combat capture exceeded its bounded original interval or repeated a row",
    );
  let previousTick = -1;
  for (const row of rows.toSorted((a, b) => a.sequence - b.sequence)) {
    if (row.serverTick < previousTick)
      throw new Error("Combat observation time moved backwards");
    previousTick = row.serverTick;
  }
}

function validateReceipt(hit: Receipt) {
  if (
    hit.before.serverTick !== hit.monitor.serverTick ||
    hit.after.serverTick !== hit.before.serverTick + 1 ||
    hit.before.sequence >= hit.monitor.sequence ||
    hit.monitor.sequence >= hit.after.sequence ||
    hit.after.sequence >= hit.sequence
  )
    throw new Error(
      "NPC attack lacks original LOWEST, MONITOR and next-tick observations",
    );
  if (
    hit.before.human.invulnerable ||
    hit.monitor.human.invulnerable ||
    hit.after.human.invulnerable
  )
    throw new Error("NPC attack was observed against protected human state");
  if (
    hit.monitor.human.health > hit.before.human.health ||
    hit.after.human.health > hit.before.human.health
  )
    throw new Error(
      "NPC attack receipt regained all health before deferred observation",
    );
}
