import { z } from "zod";

/**
 * The models the Explore picker may offer, with the label every surface shows.
 * The web select and Scout Desktop's `explore/models` route both read this
 * list, so the two pickers cannot drift.
 */
export const EXPLORE_MODEL_OPTIONS = [
  { id: "gpt-6-luna", label: "GPT-6 Luna · High" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol · High" },
] as const;
export const ExploreModelSchema = z.enum(["gpt-6-luna", "gpt-6.1-sol"]);
export type ExploreModel = z.infer<typeof ExploreModelSchema>;

/**
 * How hard the model reasoned for an answer. An ordinary Explore turn is
 * `high`; the in-game coach profile answers at `low`. `low` is newer than the
 * field: readers that predate it are sent no provenance for such an answer
 * (`withoutUnknownEffort`) rather than a value they would refuse.
 */
export const ExploreReasoningEffortSchema = z.enum(["high", "low"]);
export type ExploreReasoningEffort = z.infer<
  typeof ExploreReasoningEffortSchema
>;

/** Which model wrote an answer, and at what reasoning effort. */
export const ExploreGenerationSchema = z
  .object({
    model: z.string().min(1),
    reasoningEffort: ExploreReasoningEffortSchema,
  })
  .strict();
export type ExploreGeneration = z.infer<typeof ExploreGenerationSchema>;

/**
 * A message as a reader that knows only `high` effort reads it: an answer
 * written at another effort keeps everything but its provenance, which such a
 * reader parses strictly and would refuse.
 */
export function withoutUnknownEffort<
  Message extends { generation?: ExploreGeneration | null | undefined },
>(message: Message): Message {
  return message.generation?.reasoningEffort === "low"
    ? { ...message, generation: null }
    : message;
}
