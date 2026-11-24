import { describe, expect, test } from "vitest";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import {
  COMPENSATION_REVIEW_IDS,
  compensationReviewDetail,
} from "#testing/fixture-api/fixtures/migration/compensation.ts";
import { fixtureId } from "#testing/fixture-api/support.ts";

const OTHER = fixtureId(39, 51);

function scope() {
  const detail = compensationReviewDetail(
    COMPENSATION_REVIEW_IDS.awaitingReview,
  );
  if (detail === null) throw new Error("No compensation fixture");
  return NativeCompensationScopeSchema.parse(detail.scope);
}

/**
 * An interrupted upgrade is one publication transition, and the scope names
 * it in three places. The server builds the scope from one transition row and
 * refuses to read the intent or the interrupted work unless they carry that
 * row's id, so a scope that names different transitions is not one it wrote.
 */
describe("a compensation scope names one transition", () => {
  test("accepts the three places agreeing", () => {
    const found = scope();
    expect(found.transition.transitionId).toBe(found.intent.transitionId);
    expect(found.transition.transitionId).toBe(
      found.interruptedWork.transitionId,
    );
  });

  test.each([
    [
      "transition",
      (found: ReturnType<typeof scope>) => ({
        ...found,
        transition: { ...found.transition, transitionId: OTHER },
      }),
    ],
    [
      "intent",
      (found: ReturnType<typeof scope>) => ({
        ...found,
        intent: { ...found.intent, transitionId: OTHER },
      }),
    ],
    [
      "interrupted work",
      (found: ReturnType<typeof scope>) => ({
        ...found,
        interruptedWork: { ...found.interruptedWork, transitionId: OTHER },
      }),
    ],
  ])("rejects a scope whose %s names another transition", (_place, change) => {
    const result = NativeCompensationScopeSchema.safeParse(change(scope()));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("one transition");
  });
});
