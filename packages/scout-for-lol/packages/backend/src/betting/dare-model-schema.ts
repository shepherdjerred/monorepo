import { z } from "zod";
import { getChampionByKey, normalizeChampionName } from "@scout-for-lol/data";
import {
  DARE_DEFAULT_WINDOW_DAYS,
  DARE_MAX_CLAUSES,
  DARE_MAX_LEAVES,
  DARE_MAX_REQUIRED_GAMES,
  DARE_MAX_TARGETS,
  DARE_MAX_WINDOW_DAYS,
} from "#src/betting/constants.ts";
import {
  DARE_CONDITION_VERSION,
  DareBooleanFieldSchema,
  DareCombinatorSchema,
  DareConditionsSchema,
  DareNumericFieldSchema,
  DareRateFieldSchema,
  type DareConditions,
} from "#src/betting/dare-criteria.ts";
import type { DareShortlistEntry } from "#src/betting/dare-shortlist.ts";

/**
 * The flat shape the translation model emits.
 *
 * OpenAI-style strict structured outputs reject `oneOf` and recursion, which
 * Zod emits for `DareConditionsSchema`'s discriminated predicate union and
 * nested tree. So the model sees one closed strictObject (parlay-model-schema
 * precedent): every leaf carries every predicate slot as a nullable, the tree
 * is flattened into `clauseCombinators` + per-leaf `clauseIndex`, and
 * `canonicalizeDareTranslation` rebuilds the recursive storage contract after
 * validation. Settlement never touches this shape.
 */

/** Leaves per clause cap — mirrors `DareClauseSchema`'s `children` bound. */
const DARE_MAX_LEAVES_PER_CLAUSE = 4;

const ModelDareLeafKindSchema = z.enum([
  "participant_numeric",
  "participant_boolean",
  "participant_rate",
]);

const ModelDareOperatorSchema = z.enum(["gte", "lte", "eq"]);

const ModelDareLeafSchema = z.strictObject({
  /** Which clause this leaf belongs to (index into `clauseCombinators`). */
  clauseIndex: z
    .number()
    .int()
    .min(0)
    .max(DARE_MAX_CLAUSES - 1),
  /** "At least N qualifying games where the predicate held." */
  requiredGames: z.number().int().min(1).max(DARE_MAX_REQUIRED_GAMES),
  kind: ModelDareLeafKindSchema,
  numericField: DareNumericFieldSchema.nullable(),
  booleanField: DareBooleanFieldSchema.nullable(),
  rateField: DareRateFieldSchema.nullable(),
  operator: ModelDareOperatorSchema.nullable(),
  threshold: z.number().int().nonnegative().nullable(),
  /** Hundredths: "7 CS per minute" is 700. */
  thresholdScaled: z.number().int().nonnegative().max(1_000_000).nullable(),
  expected: z.boolean().nullable(),
  champion: z.string().min(1).max(60).nullable(),
});
type ModelDareLeaf = z.infer<typeof ModelDareLeafSchema>;

/**
 * Array minimums are deliberately absent from the base shape: an `unmappable`
 * answer must be expressible with empty arrays rather than forcing the model
 * to invent placeholder targets and leaves for a dare it is refusing. The
 * semantic minimums (at least one target, clause, and leaf) are enforced by
 * `dareTranslationSchemaFor`'s superRefine for mappable output.
 */
const ModelDareTranslationSchema = z.strictObject({
  /** The escape hatch: true means "this dare cannot be expressed", and every
   * other field is ignorable. Prompted for maintain/every-game claims,
   * off-catalog stats, and unknown player names. */
  unmappable: z.boolean(),
  unmappableReason: z.string().min(1).max(300).nullable(),
  targets: z.array(z.string().regex(/^T\d{1,2}$/)).max(DARE_MAX_TARGETS),
  horizonKind: z.enum(["next_game", "window"]),
  /** null means "the text named no window" — the harness applies
   * `DARE_DEFAULT_WINDOW_DAYS`; the model never authors the default. */
  windowDays: z.number().int().min(1).max(DARE_MAX_WINDOW_DAYS).nullable(),
  rootCombinator: DareCombinatorSchema,
  clauseCombinators: z.array(DareCombinatorSchema).max(DARE_MAX_CLAUSES),
  leaves: z.array(ModelDareLeafSchema).max(DARE_MAX_LEAVES),
});
export type DareModelTranslation = z.infer<typeof ModelDareTranslationSchema>;

type SemanticIssue = {
  path?: readonly (string | number)[];
  message: string;
};

function numericLeafMessages(leaf: ModelDareLeaf): string[] {
  const messages: string[] = [];
  if (
    leaf.numericField === null ||
    leaf.operator === null ||
    leaf.threshold === null
  ) {
    messages.push(
      "participant_numeric needs numericField, operator, and threshold",
    );
  }
  if (
    leaf.booleanField !== null ||
    leaf.rateField !== null ||
    leaf.thresholdScaled !== null ||
    leaf.expected !== null
  ) {
    messages.push("Slots unused by participant_numeric must be null");
  }
  return messages;
}

function booleanLeafMessages(leaf: ModelDareLeaf): string[] {
  const messages: string[] = [];
  if (leaf.booleanField === null || leaf.expected === null) {
    messages.push("participant_boolean needs booleanField and expected");
  }
  if (
    leaf.numericField !== null ||
    leaf.rateField !== null ||
    leaf.operator !== null ||
    leaf.threshold !== null ||
    leaf.thresholdScaled !== null
  ) {
    messages.push("Slots unused by participant_boolean must be null");
  }
  return messages;
}

function rateLeafMessages(leaf: ModelDareLeaf): string[] {
  const messages: string[] = [];
  if (
    leaf.rateField === null ||
    leaf.operator === null ||
    leaf.thresholdScaled === null
  ) {
    messages.push(
      "participant_rate needs rateField, operator, and thresholdScaled",
    );
  }
  if (leaf.operator === "eq") {
    messages.push("Rates never use eq — use gte or lte");
  }
  if (
    leaf.numericField !== null ||
    leaf.booleanField !== null ||
    leaf.threshold !== null ||
    leaf.expected !== null
  ) {
    messages.push("Slots unused by participant_rate must be null");
  }
  return messages;
}

/** Required and forbidden predicate slots per leaf kind. Unused slots must be
 * null so a stray value can never silently change a predicate's meaning. */
function leafSlotIssues(leaf: ModelDareLeaf, index: number): SemanticIssue[] {
  const messages =
    leaf.kind === "participant_numeric"
      ? numericLeafMessages(leaf)
      : leaf.kind === "participant_boolean"
        ? booleanLeafMessages(leaf)
        : rateLeafMessages(leaf);
  return messages.map((message) => ({ path: ["leaves", index], message }));
}

/** Resolve a model-supplied champion string, treating a URIError from the
 * percent-decode exactly like an unresolvable name. */
function resolveChampionOrUndefined(champion: string) {
  try {
    return getChampionByKey(normalizeChampionName(champion));
  } catch {
    return;
  }
}

function championIssues(leaf: ModelDareLeaf, index: number): SemanticIssue[] {
  if (leaf.champion === null) {
    return [];
  }
  // `normalizeChampionName` percent-decodes and THROWS a URIError on a
  // malformed escape (a model champion like "100% crit Yasuo"). A throw here
  // would escape the superRefine and be classified as a provider error, so
  // any resolution failure — thrown or returned — becomes the same semantic
  // issue and earns the model a bounded retry instead.
  const resolved = resolveChampionOrUndefined(leaf.champion);
  return resolved === undefined
    ? [
        {
          path: ["leaves", index],
          message: `Unknown champion "${leaf.champion}"`,
        },
      ]
    : [];
}

/**
 * A champion-bound leaf on a multi-target dare is unachievable from creation:
 * a leaf hits only when EVERY target played that champion, and the eligible
 * queues are all draft modes where a champion appears at most once per match.
 * Rejected here so the model gets a semantic retry, and re-checked by
 * `dareSemanticIssues` at creation.
 */
function groupChampionIssues(output: DareModelTranslation): SemanticIssue[] {
  if (output.targets.length <= 1) {
    return [];
  }
  return output.leaves.flatMap((leaf, index) =>
    leaf.champion === null
      ? []
      : [
          {
            path: ["leaves", index],
            message:
              "A dare with multiple targets cannot pin a champion — only one player can play it per game. Use champion: null or a single target",
          },
        ],
  );
}

function targetIssues(
  output: DareModelTranslation,
  allowedKeys: ReadonlySet<string>,
): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (output.targets.length === 0) {
    issues.push({
      path: ["targets"],
      message: "At least one target is required",
    });
  }
  const seen = new Set<string>();
  for (const [index, key] of output.targets.entries()) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: ["targets", index],
        message: `${key} is not in the supplied target list`,
      });
    }
    if (seen.has(key)) {
      issues.push({
        path: ["targets", index],
        message: `Duplicate target ${key}`,
      });
    }
    seen.add(key);
  }
  return issues;
}

/** Every clause index must be used and in range: clause `i` exists iff
 * `clauseCombinators[i]` exists, and an empty clause is unrepresentable in
 * the canonical tree. */
function clauseShapeIssues(output: DareModelTranslation): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const clauseCount = output.clauseCombinators.length;
  if (clauseCount === 0 || output.leaves.length === 0) {
    return [{ message: "At least one clause with one leaf is required" }];
  }
  const leavesPerClause = Array.from({ length: clauseCount }, () => 0);
  for (const [index, leaf] of output.leaves.entries()) {
    if (leaf.clauseIndex >= clauseCount) {
      issues.push({
        path: ["leaves", index],
        message: `clauseIndex ${leaf.clauseIndex.toString()} has no clause — clauseCombinators has ${clauseCount.toString()}`,
      });
      continue;
    }
    leavesPerClause[leaf.clauseIndex] =
      (leavesPerClause[leaf.clauseIndex] ?? 0) + 1;
  }
  for (const [clauseIndex, count] of leavesPerClause.entries()) {
    if (count === 0) {
      issues.push({
        path: ["clauseCombinators", clauseIndex],
        message: `Clause ${clauseIndex.toString()} has no leaves — clauseIndex values must cover every clause`,
      });
    }
    if (count > DARE_MAX_LEAVES_PER_CLAUSE) {
      issues.push({
        path: ["clauseCombinators", clauseIndex],
        message: `Clause ${clauseIndex.toString()} holds ${count.toString()} leaves — the maximum is ${DARE_MAX_LEAVES_PER_CLAUSE.toString()}`,
      });
    }
  }
  return issues;
}

function horizonIssues(output: DareModelTranslation): SemanticIssue[] {
  if (output.horizonKind !== "next_game") {
    return [];
  }
  const issues: SemanticIssue[] = [];
  if (output.windowDays !== null) {
    issues.push({
      path: ["windowDays"],
      message: "next_game dares have no window — windowDays must be null",
    });
  }
  for (const [index, leaf] of output.leaves.entries()) {
    if (leaf.requiredGames !== 1) {
      issues.push({
        path: ["leaves", index],
        message:
          "next_game dares are about one game — every requiredGames must be 1",
      });
    }
  }
  return issues;
}

function semanticIssues(
  output: DareModelTranslation,
  allowedKeys: ReadonlySet<string>,
): SemanticIssue[] {
  if (output.unmappable) {
    // Everything else is ignorable on the escape path — but the refusal must
    // carry its reason, because that reason becomes the user-facing copy.
    return output.unmappableReason === null
      ? [
          {
            path: ["unmappableReason"],
            message: "An unmappable answer must say why",
          },
        ]
      : [];
  }
  return [
    ...targetIssues(output, allowedKeys),
    ...output.leaves.flatMap((leaf, index) => [
      ...leafSlotIssues(leaf, index),
      ...championIssues(leaf, index),
    ]),
    ...groupChampionIssues(output),
    ...clauseShapeIssues(output),
    ...horizonIssues(output),
  ];
}

/**
 * The validation boundary for one translation call. Semantic issues raised
 * here participate in `generateValidatedObject`'s bounded retries, so every
 * message says what the model should have done instead.
 */
export function dareTranslationSchemaFor(
  shortlist: readonly DareShortlistEntry[],
): z.ZodType<DareModelTranslation> {
  const allowedKeys = new Set(shortlist.map((entry) => entry.key));
  return ModelDareTranslationSchema.superRefine((output, context) => {
    for (const issue of semanticIssues(output, allowedKeys)) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        ...(issue.path === undefined ? {} : { path: [...issue.path] }),
      });
    }
  });
}

/** Normalized Data Dragon key for a champion the schema already validated. */
function canonicalChampion(champion: string | null): string | null {
  if (champion === null) {
    return null;
  }
  const resolved = getChampionByKey(normalizeChampionName(champion));
  if (resolved === undefined) {
    throw new Error(
      `Champion "${champion}" did not resolve — canonicalize called on unvalidated output`,
    );
  }
  return resolved.key;
}

function canonicalPredicate(leaf: ModelDareLeaf): unknown {
  switch (leaf.kind) {
    case "participant_numeric":
      return {
        kind: leaf.kind,
        field: leaf.numericField,
        operator: leaf.operator,
        threshold: leaf.threshold,
      };
    case "participant_boolean":
      return {
        kind: leaf.kind,
        field: leaf.booleanField,
        expected: leaf.expected,
      };
    case "participant_rate":
      return {
        kind: leaf.kind,
        field: leaf.rateField,
        operator: leaf.operator,
        thresholdScaled: leaf.thresholdScaled,
      };
  }
}

export type DareCanonicalTranslation = {
  /** Resolved shortlist entries, in the model's target order. */
  targets: DareShortlistEntry[];
  horizonKind: "next_game" | "window";
  /** Defaulted: a window dare that named no length gets
   * `DARE_DEFAULT_WINDOW_DAYS`; a next_game dare has none. */
  windowDays: number | null;
  conditions: DareConditions;
};

/**
 * Rebuild the recursive storage contract from the flat model shape. The
 * result passes through `DareConditionsSchema.parse`, so what settlement
 * evaluates is always the canonical language — never the model's own output.
 */
export function canonicalizeDareTranslation(
  modelOutput: DareModelTranslation,
  shortlist: readonly DareShortlistEntry[],
): DareCanonicalTranslation {
  if (modelOutput.unmappable) {
    throw new Error("Cannot canonicalize an unmappable translation");
  }
  const byKey = new Map(shortlist.map((entry) => [entry.key, entry]));
  const targets = modelOutput.targets.map((key) => {
    const entry = byKey.get(key);
    if (entry === undefined) {
      throw new Error(
        `Target ${key} is not in the shortlist — canonicalize called on unvalidated output`,
      );
    }
    return entry;
  });
  const conditions = DareConditionsSchema.parse({
    version: DARE_CONDITION_VERSION,
    root: {
      kind: modelOutput.rootCombinator,
      clauses: modelOutput.clauseCombinators.map((kind, clauseIndex) => ({
        kind,
        children: modelOutput.leaves
          .filter((leaf) => leaf.clauseIndex === clauseIndex)
          .map((leaf) => ({
            kind: "condition",
            requiredGames: leaf.requiredGames,
            predicate: canonicalPredicate(leaf),
            champion: canonicalChampion(leaf.champion),
          })),
      })),
    },
  });
  return {
    targets,
    horizonKind: modelOutput.horizonKind,
    windowDays:
      modelOutput.horizonKind === "window"
        ? (modelOutput.windowDays ?? DARE_DEFAULT_WINDOW_DAYS)
        : null,
    conditions,
  };
}
