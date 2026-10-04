/**
 * The personality file shape, mirroring the Java loader
 * (`rwfbots.adapter.content.PersonalityFile` and the `Personality`, `Chat`,
 * `Style`, `LeverOffsets` and `PersonalityCatalog` domain records). Change both
 * sides together; `ShippedPersonalitiesTest` parses what this file emits.
 */
import { z } from "zod";

export const LEVER_KEYS = [
  "reactionMs",
  "aimErrorDeg",
  "turnRateDegPerTick",
  "cps",
  "predictionQuality",
  "decisionTemperature",
  "awarenessRadius",
  "coordination",
  "technique",
  "aggression",
] as const;
export type LeverKey = (typeof LEVER_KEYS)[number];

export const KITS = [
  "trooper",
  "longbow",
  "shortbow",
  "rewind",
  "ghost",
  "wraith",
  "spy",
] as const;
export type Kit = (typeof KITS)[number];

export const ROLES = [
  "plant",
  "escort",
  "defend",
  "rotate",
  "retake",
  "hunt",
] as const;
export type Role = (typeof ROLES)[number];

export const VERBOSITIES = ["silent", "terse", "chatty"] as const;
export type Verbosity = (typeof VERBOSITIES)[number];

/** `Personality.ID` in Java. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
/** `Personality.NAME` in Java; a leading dot is rejected separately there. */
export const NAME_PATTERN = /^\w{3,16}$/;
/** `Chat.TAG` in Java. */
const TONE_TAG_PATTERN = /^[a-z][a-z0-9-]{1,23}$/;

export const MAX_LEVER_Z = 3;
export const MAX_CATCHPHRASES = 5;
export const MAX_CATCHPHRASE_LENGTH = 100;
export const MAX_BIO_LENGTH = 280;
/** `PersonalityCatalog.MIN_NAME_DISTANCE` in Java. */
export const MIN_NAME_DISTANCE = 2;

const unit = z.number().min(0).max(1);
const positiveWeight = z.number().positive();

function weights<const Keys extends readonly [string, ...string[]]>(
  keys: Keys,
  what: string,
) {
  return z
    .partialRecord(z.enum(keys), positiveWeight)
    .refine((record) => Object.keys(record).length > 0, {
      message: `at least one ${what} weight is required`,
    });
}

export const PersonalitySchema = z.strictObject({
  id: z.string().regex(ID_PATTERN),
  name: z
    .string()
    .regex(NAME_PATTERN)
    .refine((name) => !name.startsWith("."), {
      message: "name must not start with a dot",
    }),
  skin: z.strictObject({
    value: z.string().trim().min(1),
    signature: z.string().trim().min(1),
  }),
  skill: unit,
  leverOffsets: z.partialRecord(
    z.enum(LEVER_KEYS),
    z.number().min(-MAX_LEVER_Z).max(MAX_LEVER_Z),
  ),
  kits: weights(KITS, "kit"),
  roles: weights(ROLES, "role"),
  style: z.strictObject({
    aggression: unit,
    patience: unit,
    teamplay: unit,
    risk: unit,
  }),
  chat: z.strictObject({
    tone: z.array(z.string().regex(TONE_TAG_PATTERN)),
    verbosity: z.enum(VERBOSITIES),
    catchphrases: z
      .array(z.string().trim().min(1).max(MAX_CATCHPHRASE_LENGTH))
      .max(MAX_CATCHPHRASES),
  }),
  bio: z.string().max(MAX_BIO_LENGTH),
  batch: z.number().int().min(1),
  retired: z.boolean(),
});
export type Personality = z.infer<typeof PersonalitySchema>;

/** Levenshtein distance, as `EditDistance.levenshtein` in Java. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitution,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Whether two names are far enough apart for the catalog, case-insensitively. */
export function namesAreDistinct(a: string, b: string): boolean {
  return editDistance(a.toLowerCase(), b.toLowerCase()) >= MIN_NAME_DISTANCE;
}

/**
 * The catalog rules: unique ids, unique names and pairwise name distance.
 * Returns every violation so a bad batch is reported whole.
 */
export function catalogProblems(
  personalities: readonly Personality[],
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const personality of personalities) {
    if (ids.has(personality.id)) {
      problems.push(`duplicate personality id: ${personality.id}`);
    }
    ids.add(personality.id);
    const lower = personality.name.toLowerCase();
    if (names.has(lower)) {
      problems.push(`duplicate personality name: ${personality.name}`);
    }
    names.add(lower);
  }
  for (let i = 0; i < personalities.length; i++) {
    for (let j = i + 1; j < personalities.length; j++) {
      const a = personalities[i];
      const b = personalities[j];
      if (
        a !== undefined &&
        b !== undefined &&
        !namesAreDistinct(a.name, b.name)
      ) {
        problems.push(`names too similar: ${a.name} and ${b.name}`);
      }
    }
  }
  return problems;
}

/** `manifest.json` next to the generated files. */
export const ManifestSchema = z.strictObject({
  generator: z.string(),
  generatorVersion: z.string(),
  seed: z.string(),
  count: z.number().int().positive(),
  batch: z.string(),
  batchNumber: z.number().int().min(1),
  generatedAt: z.string(),
  unverifiedNames: z.boolean(),
  personalities: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      skinSha256: z.string().regex(/^[0-9a-f]{64}$/),
      mineskinUuid: z.string(),
      textureUrl: z.url(),
    }),
  ),
});
export type Manifest = z.infer<typeof ManifestSchema>;
