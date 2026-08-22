import { describe, expect, test } from "vitest";
import {
  ExploreActiveRunSchema,
  type ExploreRunOutcome,
} from "@scout-for-lol/data";
import { observeExploreRunUntilFinished } from "#src/hooks/use-explore-run-observer.ts";
import type { ExploreClientRun } from "#src/lib/explore-client-runs.ts";

const summary = ExploreActiveRunSchema.parse({
  runId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  questionMessageId: "33333333-3333-4333-8333-333333333333",
  leafIdAtStart: null,
  versionCountAtStart: 0,
  startedAt: "2026-08-20T00:00:00.000Z",
});

function createStateHandlers(): Pick<
  Parameters<typeof observeExploreRunUntilFinished>[0],
  "updateRuns" | "setErrors"
> {
  let runs = new Map<string, ExploreClientRun>();
  let errors = new Map<string, string>();
  return {
    updateRuns: (update) => {
      runs = update(runs);
    },
    setErrors: (update) => {
      errors = typeof update === "function" ? update(errors) : update;
    },
  };
}

describe("observeExploreRunUntilFinished", () => {
  test("uses the owner-scoped outcome when the final event is lost", async () => {
    const outcomes: ExploreRunOutcome[] = [];

    await observeExploreRunUntilFinished({
      summary,
      controller: new AbortController(),
      observeRun: async () => {
        throw new Error("Observer disconnected after Stop.");
      },
      fetchActiveRuns: () => Promise.resolve([]),
      fetchRunOutcome: () => Promise.resolve("stopped"),
      finishRun: async (_run, outcome) => {
        outcomes.push(outcome);
      },
      ...createStateHandlers(),
    });

    expect(outcomes).toEqual(["stopped"]);
  });

  test("does not interrupt after one stale discovery response", async () => {
    const outcomes: ExploreRunOutcome[] = [];
    let observations = 0;

    await observeExploreRunUntilFinished({
      summary,
      controller: new AbortController(),
      observeRun: async ({ onEvent }) => {
        observations += 1;
        if (observations === 1) {
          throw new Error("Observer disconnected.");
        }
        onEvent({ type: "done", outcome: "succeeded" });
      },
      fetchActiveRuns: () => Promise.resolve([]),
      fetchRunOutcome: () => Promise.resolve(null),
      finishRun: async (_run, outcome) => {
        outcomes.push(outcome);
      },
      ...createStateHandlers(),
    });

    expect(observations).toBe(2);
    expect(outcomes).toEqual(["succeeded"]);
  });
});
