/**
 * The personality file shape, mirroring the Java loader
 * (`rwfbots.adapter.content.PersonalityFile` and the `Personality`, `Archetype`,
 * `Voice`, `Lines`, `Quirk`, `Style`, `LeverOffsets` and `PersonalityCatalog`
 * domain records). Change both sides together; `ShippedPersonalitiesTest`
 * parses what this file emits.
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

/** `Archetype` in Java, lower-case. */
export const ARCHETYPES = [
  "rusher",
  "lurker",
  "sniper",
  "bomb_diver",
  "anchor",
  "flanker",
  "support",
  "duelist",
  "hunter",
  "turtle",
  "troll",
  "tactician",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** `Voice.Verbosity` in Java, lower-case. */
export const VERBOSITIES = ["quiet", "normal", "chatty"] as const;
export type Verbosity = (typeof VERBOSITIES)[number];

/** `Quirk` in Java, lower-case. */
export const QUIRKS = [
  "always_gg",
  "crouch_spam",
  "never_eats",
  "gapple_hoarder",
  "loves_nuke",
  "late_to_everything",
  "calls_everything",
  "says_sorry",
  "blames_lag",
  "holds_grudges",
  "celebrates_early",
  "bunny_hops",
  "bow_spammer",
  "slow_starter",
  "narrates",
  "good_sport",
  "stares_down",
  "spins",
] as const;
export type Quirk = (typeof QUIRKS)[number];

/** `Lines.Placeholder` in Java. */
export const PLACEHOLDERS = ["victim", "killer", "team", "bomb"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/**
 * `Lines.Moment` in Java: each moment's YAML key and the placeholders its
 * lines may use.
 */
export const MOMENTS = {
  greet: ["team"],
  onKill: ["victim", "team"],
  onDeath: ["killer", "team"],
  onPlant: ["bomb", "team"],
  onDefuse: ["bomb", "team"],
  onWin: ["team"],
  onLoss: ["team"],
  onLastAlive: ["team"],
  taunt: ["team"],
} as const satisfies Record<string, readonly Placeholder[]>;
export type Moment = keyof typeof MOMENTS;

/** `Personality.ID` in Java. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
/** `Personality.NAME` in Java; a leading dot is rejected separately there. */
export const NAME_PATTERN = /^\w{3,16}$/;
/** `Voice.TAG` in Java. */
const TONE_TAG_PATTERN = /^[a-z][a-z0-9-]{1,23}$/;
/** `Lines.PLACEHOLDER` in Java. */
const PLACEHOLDER_PATTERN = /\{([a-z]+)\}/g;

export const MAX_LEVER_Z = 3;
export const MAX_TONE_TAGS = 4;
export const MAX_STYLE_LENGTH = 120;
export const MIN_LINES = 2;
export const MAX_LINES = 6;
export const MAX_LINE_LENGTH = 80;
export const MAX_QUIRKS = 3;
export const MAX_RIVALS = 3;
export const MAX_BIO_LENGTH = 300;
/** `PersonalityCatalog.MIN_NAME_DISTANCE` in Java. */
export const MIN_NAME_DISTANCE = 2;

/**
 * Words no chat line, bio or voice note may contain, matched as whole words
 * case-insensitively. Java checks structure only; this content gate runs
 * whenever the generator validates a personality.
 */
const BANNED_WORDS = [
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "bastard",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "ass",
  "asshole",
  "damn",
  "hell",
  "crap",
  "piss",
  "sex",
  "sexy",
  "porn",
  "rape",
  "slut",
  "whore",
  "retard",
  "retarded",
  "autistic",
  "gay",
  "fag",
  "homo",
  "tranny",
  "nazi",
  "hitler",
  "kys",
  "suicide",
  "cancer",
  "trash",
  "uninstall",
] as const;
const BANNED_PATTERN = new RegExp(
  String.raw`\b(${BANNED_WORDS.join("|")})\b`,
  "i",
);

/** The banned word `text` contains, if any. */
export function bannedWord(text: string): string | undefined {
  return BANNED_PATTERN.exec(text)?.[1];
}

/** Every placeholder a line uses; an unknown or stray brace is an error. */
export function placeholdersOf(line: string): Placeholder[] {
  const used: Placeholder[] = [];
  for (const match of line.matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1] ?? "";
    const known = PLACEHOLDERS.find((placeholder) => placeholder === key);
    if (known === undefined) {
      throw new Error(`unknown placeholder {${key}} in: '${line}'`);
    }
    used.push(known);
  }
  const rest = line.replaceAll(PLACEHOLDER_PATTERN, "");
  if (rest.includes("{") || rest.includes("}")) {
    throw new Error(`stray brace in line: '${line}'`);
  }
  return used;
}

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

/** Authored text: 1..`max` characters, no surrounding space, no banned word. */
function prose(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((text) => text.trim() === text, {
      message: "no surrounding whitespace",
    })
    .refine((text) => bannedWord(text) === undefined, {
      message: "contains a banned word",
    });
}

export const VoiceSchema = z.strictObject({
  tone: z
    .array(z.string().regex(TONE_TAG_PATTERN))
    .min(1)
    .max(MAX_TONE_TAGS)
    .refine((tags) => new Set(tags).size === tags.length, {
      message: "tone tags must be distinct",
    }),
  verbosity: z.enum(VERBOSITIES),
  style: prose(MAX_STYLE_LENGTH),
});

function pool(moment: Moment) {
  const allowed: readonly Placeholder[] = MOMENTS[moment];
  return z
    .array(prose(MAX_LINE_LENGTH))
    .min(MIN_LINES)
    .max(MAX_LINES)
    .refine((lines) => new Set(lines).size === lines.length, {
      message: `${moment} repeats a line`,
    })
    .superRefine((lines, context) => {
      for (const line of lines) {
        try {
          for (const used of placeholdersOf(line)) {
            if (!allowed.includes(used)) {
              context.addIssue({
                code: "custom",
                message: `${moment} lines may not use {${used}}: '${line}'`,
              });
            }
          }
        } catch (error) {
          context.addIssue({ code: "custom", message: String(error) });
        }
      }
    });
}

export const LinesSchema = z.strictObject({
  greet: pool("greet"),
  onKill: pool("onKill"),
  onDeath: pool("onDeath"),
  onPlant: pool("onPlant"),
  onDefuse: pool("onDefuse"),
  onWin: pool("onWin"),
  onLoss: pool("onLoss"),
  onLastAlive: pool("onLastAlive"),
  taunt: pool("taunt"),
});

const QuirksSchema = z
  .array(z.enum(QUIRKS))
  .min(1)
  .max(MAX_QUIRKS)
  .refine((quirks) => new Set(quirks).size === quirks.length, {
    message: "quirks must be distinct",
  });

const RivalsSchema = z
  .array(z.string().regex(ID_PATTERN))
  .max(MAX_RIVALS)
  .refine((rivals) => new Set(rivals).size === rivals.length, {
    message: "rivals must be distinct",
  });

/**
 * The authored text of one personality: everything the generator does not
 * write itself. Enrichment files map personality ids to this shape.
 */
export const EnrichmentSchema = z.strictObject({
  voice: VoiceSchema,
  lines: LinesSchema,
  quirks: QuirksSchema,
  rivals: RivalsSchema,
  bio: prose(MAX_BIO_LENGTH),
});
export type Enrichment = z.infer<typeof EnrichmentSchema>;

/** One `scripts/bots/enrichment/*.json` file. */
export const EnrichmentFileSchema = z.strictObject({
  batch: z.string().min(1),
  personalities: z.record(z.string().regex(ID_PATTERN), EnrichmentSchema),
});
export type EnrichmentFile = z.infer<typeof EnrichmentFileSchema>;

const SkinSchema = z.strictObject({
  value: z.string().trim().min(1),
  signature: z.string().trim().min(1),
});

export const PersonalitySchema = z.strictObject({
  id: z.string().regex(ID_PATTERN),
  name: z
    .string()
    .regex(NAME_PATTERN)
    .refine((name) => !name.startsWith("."), {
      message: "name must not start with a dot",
    }),
  skin: SkinSchema,
  skill: unit,
  archetype: z.enum(ARCHETYPES),
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
  voice: VoiceSchema,
  lines: LinesSchema,
  quirks: QuirksSchema,
  rivals: RivalsSchema,
  bio: prose(MAX_BIO_LENGTH),
  batch: z.number().int().min(1),
  retired: z.boolean(),
});
export type Personality = z.infer<typeof PersonalitySchema>;

/**
 * The fields of a shipped file that are its identity and are carried forward
 * unchanged when the generator rebuilds the catalog. Parsed loosely: every
 * other key is re-derived (traits) or re-merged (enrichment) on each run.
 */
export const IdentitySchema = z.object({
  id: z.string().regex(ID_PATTERN),
  name: z.string().regex(NAME_PATTERN),
  skin: SkinSchema,
  skill: unit,
  batch: z.number().int().min(1),
  retired: z.boolean(),
});
export type Identity = z.infer<typeof IdentitySchema>;

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

function duplicateProblems(personalities: readonly Personality[]): string[] {
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
  return problems;
}

function rivalProblems(personalities: readonly Personality[]): string[] {
  const ids = new Set(personalities.map((personality) => personality.id));
  return personalities.flatMap((personality) =>
    personality.rivals.flatMap((rival) => {
      if (rival === personality.id) {
        return [`${personality.id} names itself as a rival`];
      }
      return ids.has(rival)
        ? []
        : [`${personality.id} names an unknown rival: ${rival}`];
    }),
  );
}

function similarNameProblems(personalities: readonly Personality[]): string[] {
  const problems: string[] = [];
  personalities.forEach((a, i) => {
    for (const b of personalities.slice(i + 1)) {
      if (!namesAreDistinct(a.name, b.name)) {
        problems.push(`names too similar: ${a.name} and ${b.name}`);
      }
    }
  });
  return problems;
}

/**
 * The catalog rules: unique ids, unique names, pairwise name distance, and
 * rivals that exist and are not the personality itself. Returns every
 * violation so a bad batch is reported whole.
 */
export function catalogProblems(
  personalities: readonly Personality[],
): string[] {
  return [
    ...duplicateProblems(personalities),
    ...rivalProblems(personalities),
    ...similarNameProblems(personalities),
  ];
}

/**
 * `manifest.json` next to the generated files: every batch that was generated
 * and each personality's provenance (batch, archetype, skin pixels, texture).
 */
export const ManifestSchema = z.strictObject({
  generator: z.string(),
  generatorVersion: z.string(),
  batches: z.array(
    z.strictObject({
      batch: z.string(),
      batchNumber: z.number().int().min(1),
      seed: z.string(),
      count: z.number().int().positive(),
      generatedAt: z.string(),
      generatorVersion: z.string(),
      unverifiedNames: z.boolean(),
    }),
  ),
  enrichment: z.array(z.string()),
  personalities: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      batchNumber: z.number().int().min(1),
      archetype: z.enum(ARCHETYPES),
      skinSha256: z.string().regex(/^[0-9a-f]{64}$/),
      mineskinUuid: z.string(),
      textureUrl: z.url(),
    }),
  ),
});
export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestEntry = Manifest["personalities"][number];
export type BatchRecord = Manifest["batches"][number];
