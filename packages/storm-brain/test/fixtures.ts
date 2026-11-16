import { z } from "zod";

export const CapturedDecisionWireSchema = z.object({
  model: z.string(),
  prompt_cache_key: z.string().optional(),
  input: z.unknown(),
  system: z.array(
    z.object({
      type: z.literal("input_text"),
      text: z.string(),
      prompt_cache_breakpoint: z.boolean().optional(),
    }),
  ),
  questions: z.array(
    z.object({
      type: z.literal("choice"),
      name: z.string(),
      choices: z.array(
        z.object({
          value: z.string(),
          description: z.string().optional(),
        }),
      ),
    }),
  ),
});

/** A valid triage request body, fresh per call so tests share no mutation. */
export function triageRequestBody() {
  return {
    ticket: {
      id: 1,
      reporter: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      categoryId: "grief",
      statusId: "open",
      priorityId: "normal",
      summary: "my wall is gone",
      location: null,
      createdAt: "2017-06-01T12:00:00.000Z",
      updatedAt: "2017-06-01T12:00:00.000Z",
      claimer: null,
      triage: null,
    },
    comments: [],
    reporterHistory: [],
    reporterBanned: false,
    reporterRecentChat: [],
  };
}
