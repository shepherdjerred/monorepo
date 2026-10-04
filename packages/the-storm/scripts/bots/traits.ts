/**
 * Everything about a personality except its name and skin: stratified skill,
 * kit and role preferences, play style, lever offsets, chat and a templated
 * bio. All of it is a deterministic function of the batch plan and the seed.
 */
import { clamp, round, type Rng } from "./random.ts";
import {
  KITS,
  LEVER_KEYS,
  MAX_CATCHPHRASES,
  ROLES,
  type Kit,
  type LeverKey,
  type Role,
  type Verbosity,
} from "./schema.ts";

export const ARCHETYPES = [
  "rusher",
  "anchor",
  "support",
  "lurker",
  "flex",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const SKILL_BANDS = 5;

/** What the batch asks of one slot before any dice are rolled. */
export type Slot = {
  band: number;
  archetype: Archetype;
  primaryKit: Kit;
};

export type Style = {
  aggression: number;
  patience: number;
  teamplay: number;
  risk: number;
};

export type Traits = {
  skill: number;
  archetype: Archetype;
  leverOffsets: Partial<Record<LeverKey, number>>;
  kits: Partial<Record<Kit, number>>;
  roles: Partial<Record<Role, number>>;
  style: Style;
  chat: { tone: string[]; verbosity: Verbosity; catchphrases: string[] };
  bio: string;
};

/**
 * Stratified slots: skill bands, archetypes and primary kits each cycle through
 * their options so a batch of twenty covers every band four times, every
 * archetype four times and every kit at least twice, then the three sequences
 * are shuffled independently so they do not line up.
 */
export function planBatch(rng: Rng, count: number): Slot[] {
  const bands = rng.shuffle(
    Array.from({ length: count }, (_, i) => i % SKILL_BANDS),
  );
  const archetypes = rng.shuffle(
    Array.from(
      { length: count },
      (_, i) => ARCHETYPES[i % ARCHETYPES.length] ?? "flex",
    ),
  );
  const kits = rng.shuffle(
    Array.from({ length: count }, (_, i) => KITS[i % KITS.length] ?? "trooper"),
  );
  return bands.map((band, i) => ({
    band,
    archetype: archetypes[i] ?? "flex",
    primaryKit: kits[i] ?? "trooper",
  }));
}

const STYLE_CENTRES: Record<Archetype, Style> = {
  rusher: { aggression: 0.85, patience: 0.2, teamplay: 0.4, risk: 0.75 },
  anchor: { aggression: 0.3, patience: 0.85, teamplay: 0.6, risk: 0.2 },
  support: { aggression: 0.45, patience: 0.55, teamplay: 0.9, risk: 0.35 },
  lurker: { aggression: 0.55, patience: 0.7, teamplay: 0.2, risk: 0.65 },
  flex: { aggression: 0.5, patience: 0.5, teamplay: 0.5, risk: 0.5 },
};

const ROLE_CENTRES: Record<Archetype, Partial<Record<Role, number>>> = {
  rusher: { plant: 1, hunt: 0.8, escort: 0.4 },
  anchor: { defend: 1, retake: 0.7, rotate: 0.4 },
  support: { escort: 1, retake: 0.6, defend: 0.5 },
  lurker: { hunt: 1, rotate: 0.6, plant: 0.5 },
  flex: { rotate: 1, plant: 0.6, defend: 0.6, escort: 0.4 },
};

/** Levers an archetype leans on; positive always means stronger. */
const LEVER_LEANINGS: Record<Archetype, Partial<Record<LeverKey, number>>> = {
  rusher: { aggression: 1.2, cps: 0.5, decisionTemperature: -0.5 },
  anchor: { aggression: -1, awarenessRadius: 0.6, predictionQuality: 0.4 },
  support: { coordination: 1.1, awarenessRadius: 0.4 },
  lurker: { awarenessRadius: 0.8, reactionMs: 0.3, coordination: -0.8 },
  flex: {},
};

function jitter(rng: Rng, centre: number, spread: number): number {
  return round(clamp(centre + rng.normal() * spread, 0, 1), 2);
}

function sampleSkill(rng: Rng, band: number): number {
  const width = 1 / SKILL_BANDS;
  // Stay a little inside the band so rounding never crosses into the next one.
  return round(rng.float(band * width + 0.01, (band + 1) * width - 0.01), 3);
}

function sampleKits(rng: Rng, primary: Kit): Partial<Record<Kit, number>> {
  const kits: Partial<Record<Kit, number>> = { [primary]: 1 };
  const extras = rng.int(3);
  for (const kit of rng.sample(
    KITS.filter((candidate) => candidate !== primary),
    extras,
  )) {
    kits[kit] = round(rng.float(0.15, 0.7), 2);
  }
  return kits;
}

function sampleRoles(
  rng: Rng,
  archetype: Archetype,
): Partial<Record<Role, number>> {
  const roles: Partial<Record<Role, number>> = {};
  const centres = ROLE_CENTRES[archetype];
  for (const role of ROLES) {
    const weight = centres[role];
    if (weight !== undefined) {
      roles[role] = round(clamp(weight + rng.normal() * 0.1, 0.1, 1), 2);
    }
  }
  if (rng.chance(0.4)) {
    const spare = ROLES.filter((role) => roles[role] === undefined);
    if (spare.length > 0) {
      roles[rng.pick(spare)] = round(rng.float(0.1, 0.35), 2);
    }
  }
  return roles;
}

/**
 * Standing z-scores, clipped to +-2: the archetype's leanings plus a few
 * random quirks, each rounded so the file reads cleanly. Levers left out sit on
 * the skill curve.
 */
function sampleLeverOffsets(
  rng: Rng,
  archetype: Archetype,
): Partial<Record<LeverKey, number>> {
  const offsets: Partial<Record<LeverKey, number>> = {};
  const leanings = LEVER_LEANINGS[archetype];
  for (const lever of LEVER_KEYS) {
    const lean = leanings[lever];
    if (lean !== undefined) {
      offsets[lever] = round(clamp(lean + rng.normal() * 0.3, -2, 2), 2);
    }
  }
  const quirks = 1 + rng.int(3);
  for (const lever of rng.sample(
    LEVER_KEYS.filter((key) => offsets[key] === undefined),
    quirks,
  )) {
    const z = round(clamp(rng.normal() * 0.8, -2, 2), 2);
    if (z !== 0) {
      offsets[lever] = z;
    }
  }
  return offsets;
}

const TONES: Record<Archetype, readonly string[]> = {
  rusher: ["hype", "cocky", "loud", "impatient"],
  anchor: ["calm", "dry", "methodical", "stoic"],
  support: ["friendly", "encouraging", "chatty", "polite"],
  lurker: ["quiet", "sly", "cryptic", "deadpan"],
  flex: ["casual", "curious", "upbeat", "wry"],
};

const CATCHPHRASES: Record<Archetype, readonly string[]> = {
  rusher: [
    "rushing B dont stop me",
    "first blood is mine",
    "why wait? go go go",
    "they wont see this coming",
    "ez clap",
    "bomb's up, catch me",
    "no fear, only fuse",
  ],
  anchor: [
    "holding. come to me.",
    "patience wins rounds",
    "nobody walks past this bomb",
    "I've got site. rotate when I call.",
    "calm down, we have time",
    "let them come",
    "defuse is on me",
  ],
  support: [
    "I'm with you, go!",
    "nice one, team",
    "gapple up, I'll cover",
    "we win together or not at all",
    "call it and I'll be there",
    "gg wp everyone",
    "need backup? on my way",
  ],
  lurker: [
    "...",
    "they never check behind them",
    "shh",
    "found one.",
    "wrong corner.",
    "you heard nothing",
    "lights out",
  ],
  flex: [
    "rotating, hold a sec",
    "ok new plan",
    "I'll take whatever's open",
    "wherever you need me",
    "gg, close one",
    "ha, did not expect that",
    "brb, fixing the round",
  ],
};

function sampleChat(rng: Rng, archetype: Archetype): Traits["chat"] {
  const roll = rng.next();
  const verbosity: Verbosity =
    roll < 0.15 ? "silent" : roll < 0.6 ? "terse" : "chatty";
  const tone = rng.sample(TONES[archetype], 1 + rng.int(2)).sort();
  const lines =
    verbosity === "silent" ? 0 : verbosity === "terse" ? 2 : 3 + rng.int(2);
  const catchphrases = rng.sample(
    CATCHPHRASES[archetype],
    Math.min(lines, MAX_CATCHPHRASES),
  );
  return { tone, verbosity, catchphrases };
}

const TIERS: readonly string[] = [
  "newcomer",
  "regular",
  "solid player",
  "veteran",
  "terror",
];

const ARCHETYPE_BLURBS: Record<Archetype, string> = {
  rusher:
    "lives for the first fight of the round and plants before anyone has settled",
  anchor: "parks next to the team's bomb and makes every push pay for it",
  support:
    "sticks to the planter, shares every sighting and eats the arrows meant for others",
  lurker:
    "drifts off the map, waits for footsteps and shows up where nobody is looking",
  flex: "takes whatever job is open and rotates the moment the fight shifts",
};

const KIT_BLURBS: Record<Kit, string> = {
  trooper: "iron sword and golden apples",
  longbow: "a Punch bow kept at range",
  shortbow: "a Power bow and a knockback sword",
  rewind: "a clock that undoes the last thirty seconds",
  ghost: "no armor and nothing to see",
  wraith: "speed, invisibility and very little health",
  spy: "someone else's team colors",
};

function bio(
  archetype: Archetype,
  skill: number,
  primary: Kit,
  chatty: boolean,
): string {
  const tier =
    TIERS[Math.min(TIERS.length - 1, Math.floor(skill * TIERS.length))] ??
    "regular";
  const voice = chatty ? "Talks a lot." : "Does not say much.";
  return `A Search and Destroy ${tier} who ${ARCHETYPE_BLURBS[archetype]}. Usually seen with ${KIT_BLURBS[primary]}. ${voice}`;
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

/** Every trait for one slot. */
export function sampleTraits(rng: Rng, slot: Slot): Traits {
  const skill = sampleSkill(rng, slot.band);
  const centre = STYLE_CENTRES[slot.archetype];
  const style: Style = {
    aggression: jitter(rng, centre.aggression, 0.1),
    patience: jitter(rng, centre.patience, 0.1),
    teamplay: jitter(rng, centre.teamplay, 0.1),
    risk: jitter(rng, centre.risk, 0.1),
  };
  const chat = sampleChat(rng, slot.archetype);
  return {
    skill,
    archetype: slot.archetype,
    leverOffsets: ordered(LEVER_KEYS, sampleLeverOffsets(rng, slot.archetype)),
    kits: ordered(KITS, sampleKits(rng, slot.primaryKit)),
    roles: ordered(ROLES, sampleRoles(rng, slot.archetype)),
    style,
    chat,
    bio: bio(
      slot.archetype,
      skill,
      slot.primaryKit,
      chat.verbosity === "chatty",
    ),
  };
}

/**
 * Extension point, deliberately a no-op in this version: a later version may
 * rewrite `bio` and `chat.catchphrases` with a language model, keyed on the
 * traits here, and record the model in the manifest. Nothing in this script
 * calls a model today, so output stays reproducible from the seed alone.
 */
export function enrichWithLlm(traits: Traits): Traits {
  return traits;
}
