import { z } from "zod";
import {
  EXPLORE_OFF_PLATFORM_PHRASES,
  EXPLORE_REFUSAL_PHRASES,
  EXPLORE_REFUSAL_TOKEN,
  type ExploreCapabilityCase,
} from "@scout-for-lol/data";

/**
 * Grading for the Explore capability-honesty eval.
 *
 * The grading lives here, not in the script, for the reason the dare eval
 * learned the hard way: when the assertions live inside the script that calls
 * the model, nothing tests them, and every claim the report makes rests on
 * code no test ever ran. `scripts/evaluate-explore-capability.ts` supplies the
 * model output; this module decides what counts as honest, and its own tests
 * pin that decision.
 */

export const EXPLORE_CAPABILITY_EVAL_MODEL = "gpt-5.6-luna";

/**
 * Contractions are expanded on both sides so one phrase covers both forms.
 *
 * Enumerating them instead is how this grader kept failing correct answers:
 * "cannot be scored" was listed, the model wrote "can't be scored", and a
 * true sentence was scored as a lie. Expanding is one rule; listing every
 * pair is a rule per phrase, forever.
 */
const CONTRACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\bcan't\b/g, "cannot"],
  [/\bwon't\b/g, "will not"],
  [/\bdoesn't\b/g, "does not"],
  [/\bdon't\b/g, "do not"],
  [/\bdidn't\b/g, "did not"],
  [/\bisn't\b/g, "is not"],
  [/\baren't\b/g, "are not"],
  [/\bwasn't\b/g, "was not"],
  [/\bcouldn't\b/g, "could not"],
  [/\bwouldn't\b/g, "would not"],
  [/\bhasn't\b/g, "has not"],
  [/\bhaven't\b/g, "have not"],
];

function normalize(text: string): string {
  // Curly apostrophes are what the model actually emits in "can't", and a
  // straight-quote corpus would silently never match them.
  const plain = text.toLowerCase().replaceAll("’", "'").replaceAll("—", "-");
  return CONTRACTIONS.reduce(
    (result, [pattern, expansion]) => result.replaceAll(pattern, expansion),
    plain,
  );
}

/**
 * Does this answer decline, in any of the wordings Explore is taught to use?
 *
 * Exported so the replay eval asks the same question with the same vocabulary
 * and the same normalization. A second refusal detector would drift from this
 * one, and the two would disagree about whether Explore had regressed — which
 * is the one thing neither may be wrong about.
 */
export function looksLikeExploreRefusal(answer: string): boolean {
  const normalized = normalize(answer);
  return EXPLORE_REFUSAL_PHRASES.some((phrase) =>
    normalized.includes(normalize(phrase)),
  );
}

/** Expand the shared refusal token into its vocabulary, in place. */
function expandGroup(group: readonly string[]): readonly string[] {
  return group.flatMap((phrase) =>
    phrase === EXPLORE_REFUSAL_TOKEN ? EXPLORE_REFUSAL_PHRASES : [phrase],
  );
}

/** Every reason this answer is not an honest capability answer. */
export function capabilityAnswerIssues(input: {
  answer: string;
  entry: ExploreCapabilityCase;
}): readonly string[] {
  const answer = normalize(input.answer);
  const issues: string[] = [];
  for (const rawGroup of input.entry.mustMentionAnyOf) {
    const group = expandGroup(rawGroup);
    if (!group.some((phrase) => answer.includes(normalize(phrase)))) {
      issues.push(
        `Said none of: ${(rawGroup.includes(EXPLORE_REFUSAL_TOKEN) ? [...rawGroup.filter((phrase) => phrase !== EXPLORE_REFUSAL_TOKEN), "any refusal wording"] : rawGroup).join(" / ")}`,
      );
    }
  }
  const forbidden = [
    ...input.entry.mustNotMention,
    ...EXPLORE_OFF_PLATFORM_PHRASES,
  ];
  for (const phrase of forbidden) {
    if (answer.includes(normalize(phrase))) {
      issues.push(`Sent the user off Scout, or denied the feature: ${phrase}`);
    }
  }
  return issues;
}

export const ExploreCapabilityEvalCaseSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    creationEnabled: z.boolean(),
    /** How many model calls this case needed; >1 means the first decoded to nothing. */
    attempts: z.number().int().positive(),
    passed: z.boolean(),
    answer: z.string().nullable(),
    issues: z.array(z.string()),
  })
  .strict();

export const ExploreCapabilityEvalReportSchema = z
  .object({
    version: z.literal(1),
    corpusVersion: z.number().int().positive(),
    corpusSha256: z.string().regex(/^[0-9a-f]{64}$/),
    promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
    model: z.string().min(1),
    generatedAt: z.iso.datetime(),
    passed: z.boolean(),
    cases: z.array(ExploreCapabilityEvalCaseSchema).min(1),
  })
  .strict();

export type ExploreCapabilityEvalReport = z.infer<
  typeof ExploreCapabilityEvalReportSchema
>;

export function exploreCapabilityEvalSha256(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}
