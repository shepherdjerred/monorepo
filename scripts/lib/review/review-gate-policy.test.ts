import { describe, expect, test, vi } from "vitest";
import { codexProvider } from "@shepherdjerred/code-review";
import { ensureReviewRequested } from "./review-gate-policy.ts";

describe("ensureReviewRequested", () => {
  test("does not ask again once the provider reports it is blocked", async () => {
    // Asking a quota-exhausted provider only draws another limit notice on
    // the pull request, so a blocked head is never re-requested — and the
    // suppression happens before any GitHub read.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json([]));
    try {
      const attempt = await ensureReviewRequested({
        repo: "o/r",
        number: 1,
        head: "abc123",
        token: "token",
        provider: codexProvider,
        attempt: 1,
        graceSeconds: 0,
        retryAfterSeconds: 900,
        headPushedAt: null,
        startedAt: Date.now(),
        reviewedCommit: null,
        blockedReason: "usage-limited",
      });
      expect(attempt).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
