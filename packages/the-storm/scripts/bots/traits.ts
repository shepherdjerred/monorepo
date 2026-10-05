/**
 * The play knobs of a personality, derived from its archetype: style, role and
 * kit weights, and lever offsets. Each archetype has a profile (below) and every
 * personality is that profile plus seeded jitter, so two rushers differ but a
 * rusher never plays like a turtle. All of it is a deterministic function of
 * the batch seed, the personality id, its archetype and its skill.
 *
 * Only knobs the bots actually read are set with intent. What reads them
 * (rwfbots `domain`):
 *
 * - `style.aggression`: the team's round strategy (`TeamBrain.chooseStrategy`,
 *   rush and hunt weights) and the stance on bomb routes (`Planner.stanceFor`,
 *   aggressive above 0.6).
 * - `style.patience`: the turtle strategy weight, and `GUARD_CHOKE` /
 *   `HOLD_ANGLE` utilities (`Utilities.positioning`).
 * - `style.teamplay`: the `ESCORT` utility.
 * - `style.risk`: the `ARM` utility (going for the enemy bomb).
 * - `roles`: the weights `RoleUtilities` bends by situation before the team
 *   deals roles; PLANT, DEFEND, ESCORT, ROTATE, RETAKE and HUNT each boost
 *   their matching options.
 * - `kits`: the `Director` draws the bot's kit from these weights over the kits
 *   on offer (trooper, longbow, shortbow and rewind ship today).
 * - lever `aggression`: `ENGAGE`, `RETREAT`, `HOLD_ANGLE` and `HUNT` utilities.
 * - lever `decisionTemperature`: softmax sharpness; a negative z makes choices
 *   erratic.
 * - levers `awarenessRadius` (perception), `coordination` (sharing sightings),
 *   `reactionMs`, `aimErrorDeg`, `turnRateDegPerTick`, `cps`,
 *   `predictionQuality` and `technique` (reflexes: aim, clicking, bow lead,
 *   w-taps, crits, fuse slips).
 */
import { clamp, round, type Rng } from "./random.ts";
import {
  ARCHETYPES,
  KITS,
  LEVER_KEYS,
  ROLES,
  type Archetype,
  type Kit,
  type LeverKey,
  type Role,
} from "./schema.ts";

export const SKILL_BANDS = 5;

export type Style = {
  aggression: number;
  patience: number;
  teamplay: number;
  risk: number;
};

/** An archetype's centre: what every personality of it is jittered around. */
export type Profile = {
  style: Style;
  roles: Partial<Record<Role, number>>;
  kits: Partial<Record<Kit, number>>;
  /** Lever z-scores; positive is always stronger. */
  levers: Partial<Record<LeverKey, number>>;
};

/**
 * The archetype profiles. Read these as "what the archetype changes in play":
 *
 * - rusher: high style and lever aggression, aggressive stance, plant + hunt
 *   roles, fast hands; low awareness.
 * - lurker: patient, solitary (low coordination, teamplay), hunt + rotate roles,
 *   wide awareness, ghost/wraith when they ship.
 * - sniper: longbow first, defend + hunt roles, sharp aim and bow lead, slow
 *   melee, low lever aggression so it holds angles.
 * - bomb_diver: maximum risk and plant weight, low lever aggression (avoids
 *   fights on the way), clean fuse technique, decisive.
 * - anchor: defend + retake roles, high patience, low aggression, quick
 *   reactions and awareness around the bomb.
 * - flanker: rotate role first, shortbow, fast turning and lead, solitary.
 * - support: escort role and maximum teamplay, best coordination, rewind.
 * - duelist: top cps, technique and aim, high lever aggression, hunt + retake.
 * - hunter: hunt role first, high aggression, prediction and awareness (the
 *   `HUNT` utility chases remembered enemies).
 * - turtle: lowest aggression, maximum patience, defend role, quick reactions,
 *   rewind and gapples.
 * - troll: very high decision temperature (erratic choices), flat roles, high
 *   risk, poor coordination.
 * - tactician: best decision temperature and coordination, flat roles so the
 *   team can deal it anything, high teamplay.
 */
export const PROFILES: Record<Archetype, Profile> = {
  rusher: {
    style: { aggression: 0.9, patience: 0.12, teamplay: 0.4, risk: 0.75 },
    roles: { plant: 0.8, hunt: 0.7, escort: 0.45 },
    kits: { trooper: 1, shortbow: 0.55, rewind: 0.3 },
    levers: {
      aggression: 1.6,
      cps: 0.6,
      reactionMs: 0.4,
      decisionTemperature: 0.4,
      awarenessRadius: -0.6,
    },
  },
  lurker: {
    style: { aggression: 0.45, patience: 0.85, teamplay: 0.12, risk: 0.6 },
    roles: { hunt: 0.85, rotate: 0.75, plant: 0.3 },
    kits: { trooper: 0.7, shortbow: 0.6, ghost: 0.8, wraith: 0.6 },
    levers: {
      awarenessRadius: 1.3,
      coordination: -1.3,
      aggression: -0.4,
      predictionQuality: 0.4,
    },
  },
  sniper: {
    style: { aggression: 0.3, patience: 0.88, teamplay: 0.45, risk: 0.2 },
    roles: { defend: 0.75, hunt: 0.6, rotate: 0.4 },
    kits: { longbow: 1, shortbow: 0.45, trooper: 0.15 },
    levers: {
      aimErrorDeg: 1.6,
      predictionQuality: 1.3,
      awarenessRadius: 0.9,
      cps: -0.9,
      technique: -0.4,
      aggression: -0.7,
    },
  },
  bomb_diver: {
    style: { aggression: 0.68, patience: 0.08, teamplay: 0.3, risk: 0.96 },
    roles: { plant: 1, escort: 0.2 },
    kits: { trooper: 1, rewind: 0.6, shortbow: 0.2 },
    levers: {
      aggression: -0.5,
      technique: 0.9,
      decisionTemperature: 0.7,
      reactionMs: 0.3,
    },
  },
  anchor: {
    style: { aggression: 0.3, patience: 0.9, teamplay: 0.6, risk: 0.15 },
    roles: { defend: 1, retake: 0.7 },
    kits: { trooper: 1, longbow: 0.45, rewind: 0.3 },
    levers: {
      aggression: -0.9,
      awarenessRadius: 0.7,
      reactionMs: 0.5,
      coordination: 0.3,
    },
  },
  flanker: {
    style: { aggression: 0.66, patience: 0.42, teamplay: 0.25, risk: 0.7 },
    roles: { rotate: 1, hunt: 0.5, plant: 0.4 },
    kits: { shortbow: 1, trooper: 0.6, rewind: 0.35, wraith: 0.5, spy: 0.4 },
    levers: {
      turnRateDegPerTick: 0.9,
      predictionQuality: 0.5,
      coordination: -0.7,
      aggression: 0.4,
    },
  },
  support: {
    style: { aggression: 0.35, patience: 0.55, teamplay: 0.96, risk: 0.3 },
    roles: { escort: 1, retake: 0.6, defend: 0.4 },
    kits: { trooper: 1, rewind: 0.7, longbow: 0.3 },
    levers: { coordination: 1.7, awarenessRadius: 0.5, aggression: -0.4 },
  },
  duelist: {
    style: { aggression: 0.85, patience: 0.3, teamplay: 0.3, risk: 0.5 },
    roles: { hunt: 0.8, retake: 0.5, escort: 0.35 },
    kits: { trooper: 1, shortbow: 0.4 },
    levers: {
      cps: 1.4,
      technique: 1.4,
      aimErrorDeg: 0.6,
      aggression: 1.1,
      coordination: -0.4,
    },
  },
  hunter: {
    style: { aggression: 0.76, patience: 0.4, teamplay: 0.35, risk: 0.55 },
    roles: { hunt: 1, rotate: 0.4 },
    kits: { shortbow: 0.85, trooper: 0.65, longbow: 0.5 },
    levers: {
      aggression: 0.9,
      predictionQuality: 1.1,
      awarenessRadius: 1,
      turnRateDegPerTick: 0.5,
    },
  },
  turtle: {
    style: { aggression: 0.12, patience: 0.96, teamplay: 0.55, risk: 0.08 },
    roles: { defend: 1, retake: 0.4 },
    kits: { trooper: 1, rewind: 0.8, longbow: 0.3 },
    levers: {
      aggression: -1.7,
      reactionMs: 0.6,
      awarenessRadius: 0.4,
      decisionTemperature: 0.4,
    },
  },
  troll: {
    style: { aggression: 0.6, patience: 0.25, teamplay: 0.1, risk: 0.9 },
    roles: { hunt: 0.5, rotate: 0.5, plant: 0.5, escort: 0.3 },
    kits: { rewind: 1, shortbow: 0.7, trooper: 0.5, spy: 0.8 },
    levers: { decisionTemperature: -2.2, coordination: -1.2, technique: 0.4 },
  },
  tactician: {
    style: { aggression: 0.45, patience: 0.65, teamplay: 0.85, risk: 0.4 },
    roles: { rotate: 0.7, retake: 0.7, plant: 0.6, escort: 0.5, defend: 0.5 },
    kits: { trooper: 1, longbow: 0.5, shortbow: 0.5, rewind: 0.5 },
    levers: {
      coordination: 1.6,
      decisionTemperature: 1.3,
      awarenessRadius: 0.5,
      predictionQuality: 0.4,
    },
  },
};

/** What the batch asks of one new personality before any dice are rolled. */
export type Slot = { archetype: Archetype; band: number };

export type Traits = {
  leverOffsets: Partial<Record<LeverKey, number>>;
  kits: Partial<Record<Kit, number>>;
  roles: Partial<Record<Role, number>>;
  style: Style;
};

/** The skill band (0..4) a skill falls in. */
export function bandOf(skill: number): number {
  return Math.min(SKILL_BANDS - 1, Math.floor(skill * SKILL_BANDS));
}

/** The entry of `counts` with the fewest, ties broken by `order`. */
function fewest<K>(order: readonly K[], counts: Map<K, number>): K {
  let best: K | undefined;
  for (const key of order) {
    if (
      best === undefined ||
      (counts.get(key) ?? 0) < (counts.get(best) ?? 0)
    ) {
      best = key;
    }
  }
  if (best === undefined) {
    throw new Error("nothing to choose from");
  }
  return best;
}

/**
 * Stratified slots for `count` new personalities on top of `existing` ones:
 * each slot goes to the archetype with the fewest personalities so far, then
 * to that archetype's emptiest skill band, so the whole catalog stays even
 * across archetypes and every archetype spans every band. The slots are then
 * shuffled so archetypes do not line up with name order.
 */
export function planBatch(
  rng: Rng,
  count: number,
  existing: readonly { archetype: Archetype; skill: number }[],
): Slot[] {
  const perArchetype = new Map<Archetype, number>();
  const perBand = new Map<string, number>();
  for (const personality of existing) {
    perArchetype.set(
      personality.archetype,
      (perArchetype.get(personality.archetype) ?? 0) + 1,
    );
    const key = `${personality.archetype}:${String(bandOf(personality.skill))}`;
    perBand.set(key, (perBand.get(key) ?? 0) + 1);
  }
  const archetypeOrder = rng.shuffle(ARCHETYPES);
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const archetype = fewest(archetypeOrder, perArchetype);
    perArchetype.set(archetype, (perArchetype.get(archetype) ?? 0) + 1);
    const bands = rng.shuffle(
      Array.from({ length: SKILL_BANDS }, (_, band) => band),
    );
    const bandCounts = new Map(
      bands.map((band) => [
        band,
        perBand.get(`${archetype}:${String(band)}`) ?? 0,
      ]),
    );
    const band = fewest(bands, bandCounts);
    const key = `${archetype}:${String(band)}`;
    perBand.set(key, (perBand.get(key) ?? 0) + 1);
    slots.push({ archetype, band });
  }
  return rng.shuffle(slots);
}

/** A skill inside `band`, a little inside its edges so rounding never crosses. */
export function sampleSkill(rng: Rng, band: number): number {
  const width = 1 / SKILL_BANDS;
  return round(rng.float(band * width + 0.01, (band + 1) * width - 0.01), 3);
}

function jitter(rng: Rng, centre: number, spread: number): number {
  return round(clamp(centre + rng.normal() * spread, 0, 1), 2);
}

/** The profile's kits scaled by up to +-15%, plus sometimes one more kit. */
function sampleKits(rng: Rng, profile: Profile): Partial<Record<Kit, number>> {
  const kits: Partial<Record<Kit, number>> = {};
  for (const kit of KITS) {
    const weight = profile.kits[kit];
    if (weight !== undefined) {
      kits[kit] = round(clamp(weight * rng.float(0.85, 1.15), 0.1, 1), 2);
    }
  }
  if (rng.chance(0.3)) {
    const spare = KITS.filter((kit) => kits[kit] === undefined);
    if (spare.length > 0) {
      kits[rng.pick(spare)] = round(rng.float(0.1, 0.35), 2);
    }
  }
  return kits;
}

function sampleRoles(
  rng: Rng,
  profile: Profile,
): Partial<Record<Role, number>> {
  const roles: Partial<Record<Role, number>> = {};
  for (const role of ROLES) {
    const weight = profile.roles[role];
    if (weight !== undefined) {
      roles[role] = round(clamp(weight + rng.normal() * 0.08, 0.1, 1), 2);
    }
  }
  if (rng.chance(0.3)) {
    const spare = ROLES.filter((role) => roles[role] === undefined);
    if (spare.length > 0) {
      roles[rng.pick(spare)] = round(rng.float(0.1, 0.3), 2);
    }
  }
  return roles;
}

/**
 * The profile's lever leanings with a little noise, plus one or two personal
 * strengths or weaknesses on other levers; clipped to +-2.5.
 */
function sampleLeverOffsets(
  rng: Rng,
  profile: Profile,
): Partial<Record<LeverKey, number>> {
  const offsets: Partial<Record<LeverKey, number>> = {};
  for (const lever of LEVER_KEYS) {
    const lean = profile.levers[lever];
    if (lean !== undefined) {
      offsets[lever] = round(clamp(lean + rng.normal() * 0.25, -2.5, 2.5), 2);
    }
  }
  const personal = 1 + rng.int(2);
  for (const lever of rng.sample(
    LEVER_KEYS.filter((key) => offsets[key] === undefined),
    personal,
  )) {
    const z = round(clamp(rng.normal() * 0.6, -1.5, 1.5), 2);
    if (z !== 0) {
      offsets[lever] = z;
    }
  }
  return offsets;
}

/** The same weights with keys in canonical order, so files read consistently. */
function ordered<K extends string>(
  keys: readonly K[],
  weights: Partial<Record<K, number>>,
): Partial<Record<K, number>> {
  const result: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const weight = weights[key];
    if (weight !== undefined) {
      result[key] = weight;
    }
  }
  return result;
}

/** Every knob of one personality, from its archetype's profile. */
export function sampleTraits(rng: Rng, archetype: Archetype): Traits {
  const profile = PROFILES[archetype];
  const centre = profile.style;
  const style: Style = {
    aggression: jitter(rng, centre.aggression, 0.06),
    patience: jitter(rng, centre.patience, 0.06),
    teamplay: jitter(rng, centre.teamplay, 0.06),
    risk: jitter(rng, centre.risk, 0.06),
  };
  return {
    leverOffsets: ordered(LEVER_KEYS, sampleLeverOffsets(rng, profile)),
    kits: ordered(KITS, sampleKits(rng, profile)),
    roles: ordered(ROLES, sampleRoles(rng, profile)),
    style,
  };
}
