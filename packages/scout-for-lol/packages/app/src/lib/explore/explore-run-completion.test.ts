import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  ExploreMessageSchema,
  ExploreRunOutcomeSchema,
} from "@scout-for-lol/data";
import reducerFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-turn-reducer.json" with { type: "json" };
import {
  resolveExploreRunCompletion,
  shouldClearExploreRunMarker,
} from "#src/lib/explore/explore-run-completion.ts";

/**
 * Completion cases shared with Scout Desktop's Rust port
 * (`scout-explore-client`), which runs the same file.
 */
const CompletionCaseSchema = z.strictObject({
  name: z.string().min(1),
  run: z.strictObject({
    questionMessageId: z.uuid(),
    versionCountAtStart: z.number().int().nonnegative(),
  }),
  outcome: ExploreRunOutcomeSchema,
  finalMessageId: z.uuid().nullable(),
  messages: z.array(ExploreMessageSchema),
  expect: z.strictObject({
    markerState: z.enum(["completed", "failed"]).nullable(),
    answerVisible: z.boolean(),
  }),
  clear: z
    .strictObject({
      displayedConversationId: z.uuid().nullable(),
      runConversationId: z.uuid(),
      expect: z.boolean(),
    })
    .optional(),
});
const { completions } = z
  .looseObject({ completions: z.array(CompletionCaseSchema).min(1) })
  .parse(reducerFixture);

describe("resolveExploreRunCompletion", () => {
  test.each(completions.map((completion) => [completion.name, completion]))(
    "%s",
    (_name, completion) => {
      const resolved = resolveExploreRunCompletion(completion);
      expect(resolved).toEqual(completion.expect);
      if (completion.clear !== undefined) {
        expect(
          shouldClearExploreRunMarker({
            ...resolved,
            displayedConversationId: completion.clear.displayedConversationId,
            runConversationId: completion.clear.runConversationId,
          }),
        ).toBe(completion.clear.expect);
      }
    },
  );
});
