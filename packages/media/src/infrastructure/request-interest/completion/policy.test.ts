import { expect, test } from "vitest";
import { renewedCompletionFence } from "#infrastructure/request-interest/policy.ts";

test.each(["watched", "series_finished"])(
  "a durable native %s release begins a new completion cycle",
  (interestReleaseReason) => {
    const now = new Date();
    expect(
      renewedCompletionFence(
        { interestReleaseReason, completionRequiredAfter: new Date(0) },
        now,
      ),
    ).toEqual({ completionRequiredAfter: now });
  },
);

test.each([null, "finished_manually", "dropped_manually", "lost_interest"])(
  "unfinished %s renewals retain ordinary or strict-cycle credit",
  (interestReleaseReason) => {
    for (const completionRequiredAfter of [null, new Date(1)]) {
      expect(
        renewedCompletionFence(
          { interestReleaseReason, completionRequiredAfter },
          new Date(2),
        ),
      ).toEqual({});
    }
    expect(renewedCompletionFence(null, new Date())).toEqual({});
  },
);
