import { z } from "zod";
import {
  EXPLORE_OFF_PLATFORM_PHRASES,
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

function normalize(text: string): string {
  // Curly apostrophes are what the model actually emits in "can't", and a
  // straight-quote corpus would silently never match them.
  return text.toLowerCase().replaceAll("’", "'").replaceAll("—", "-");
}

/** Every reason this answer is not an honest capability answer. */
export function capabilityAnswerIssues(input: {
  answer: string;
  entry: ExploreCapabilityCase;
}): readonly string[] {
  const answer = normalize(input.answer);
  const issues: string[] = [];
  for (const group of input.entry.mustMentionAnyOf) {
    if (!group.some((phrase) => answer.includes(normalize(phrase)))) {
      issues.push(`Said none of: ${group.join(" / ")}`);
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
