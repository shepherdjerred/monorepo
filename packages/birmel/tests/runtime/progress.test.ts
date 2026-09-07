import { describe, expect, test } from "vitest";
import {
  createProgressReporter,
  humanizeToolLabel,
  renderProgress,
} from "@shepherdjerred/birmel/agent-runtime/progress.ts";

describe("humanizeToolLabel", () => {
  test("reads a tool id as words", () => {
    expect(humanizeToolLabel("get-activity-stats", {})).toBe(
      "Get activity stats",
    );
  });

  test("includes the action when the input names one", () => {
    expect(humanizeToolLabel("manage-role", { action: "add" })).toBe(
      "Manage role (add)",
    );
  });

  test("ignores input that is not an action-shaped object", () => {
    expect(humanizeToolLabel("web-research", { query: "anything" })).toBe(
      "Web research",
    );
  });
});

describe("renderProgress", () => {
  test("marks running, done, and failed steps distinctly", () => {
    const body = renderProgress({
      entries: [
        {
          toolCallId: "a",
          label: "Get activity stats",
          status: "done",
          durationMs: 400,
        },
        {
          toolCallId: "b",
          label: "Manage role (add)",
          status: "failed",
          durationMs: 1200,
        },
        { toolCallId: "c", label: "Manage role (list)", status: "running" },
      ],
      narration: "Checking who has been active, then updating the role.",
      stepNumber: 3,
      maxSteps: 12,
      elapsedMs: 14_000,
    });

    expect(body).toContain("✓ Get activity stats · 400ms");
    expect(body).toContain("✗ Manage role (add) · 1.2s");
    expect(body).toContain("⋯ Manage role (list)");
    expect(body).toContain("> Checking who has been active");
    expect(body).toContain("step 3/12 · 14.0s");
  });

  test("summarizes older steps instead of growing without bound", () => {
    const body = renderProgress({
      entries: Array.from({ length: 12 }, (_, index) => ({
        toolCallId: String(index),
        label: `Step ${String(index)}`,
        status: "done" as const,
        durationMs: 10,
      })),
      narration: undefined,
      stepNumber: 12,
      maxSteps: 12,
      elapsedMs: 1000,
    });

    expect(body).toContain("… 4 earlier steps");
    expect(body).not.toContain("Step 0");
    expect(body).toContain("Step 11");
  });

  test("stays inside Discord's message ceiling", () => {
    const body = renderProgress({
      entries: Array.from({ length: 8 }, (_, index) => ({
        toolCallId: String(index),
        label: "x".repeat(400),
        status: "done" as const,
        durationMs: 10,
      })),
      narration: "y".repeat(4000),
      stepNumber: 8,
      maxSteps: 12,
      elapsedMs: 1000,
    });

    expect(body.length).toBeLessThanOrEqual(2000);
  });
});

function harness(startAt = 0) {
  const published: string[] = [];
  const errors: unknown[] = [];
  let clock = startAt;
  const reporter = createProgressReporter({
    maxSteps: 12,
    now: () => clock,
    minPublishIntervalMs: 1000,
    publish: async (body) => {
      published.push(body);
    },
    onPublishError: (error) => {
      errors.push(error);
    },
  });
  return {
    reporter,
    published,
    errors,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createProgressReporter", () => {
  test("publishes the first update immediately", async () => {
    const { reporter, published } = harness();
    reporter.toolStarted("call-1", "get-activity-stats", {});
    await reporter.flush();

    expect(published).toHaveLength(1);
    expect(published[0]).toContain("⋯ Get activity stats");
  });

  test("coalesces rapid updates instead of editing per event", async () => {
    const { reporter, published, advance } = harness();
    reporter.toolStarted("call-1", "get-activity-stats", {});
    reporter.toolFinished("call-1", true, 10);
    reporter.toolStarted("call-2", "manage-role", { action: "add" });
    advance(10);
    await reporter.flush();

    // One immediate publish, then a single coalesced flush for the rest.
    expect(published).toHaveLength(2);
    expect(published.at(-1)).toContain("⋯ Manage role (add)");
    expect(published.at(-1)).toContain("✓ Get activity stats");
  });

  test("publishes again once the interval has passed", async () => {
    const { reporter, published, advance } = harness();
    reporter.toolStarted("call-1", "get-activity-stats", {});
    advance(1500);
    reporter.toolFinished("call-1", true, 1500);
    await reporter.flush();

    expect(published).toHaveLength(2);
  });

  test("records a failed tool as failed", async () => {
    const { reporter, published, advance } = harness();
    reporter.toolStarted("call-1", "manage-role", { action: "add" });
    advance(1500);
    reporter.toolFinished("call-1", false, 900);
    await reporter.flush();

    expect(published.at(-1)).toContain("✗ Manage role (add)");
  });

  test("uses the model's own narration when it gives one", async () => {
    const { reporter, published, advance } = harness();
    reporter.stepStarted(0);
    reporter.stepFinished(0, "Looking up who has been active this week.");
    advance(1500);
    reporter.toolStarted("call-1", "get-activity-stats", {});
    await reporter.flush();

    expect(published.at(-1)).toContain(
      "> Looking up who has been active this week.",
    );
  });

  test("keeps narration visible while its own step's tool is still running", async () => {
    const { reporter, published, advance } = harness();
    reporter.stepStarted(0);
    reporter.stepFinished(0, "First thing.");
    advance(1500);
    reporter.toolStarted("call-1", "manage-role", {});
    await reporter.flush();

    expect(published.at(-1)).toContain("> First thing.");
  });

  test("hides narration once a newer step starts without giving one", async () => {
    // The narration describes the step it came from. Leaving it on screen
    // once a different step's tool is running would mislabel that new work
    // as whatever the old text described - exactly the staleness a
    // throttled, coalesced timeline has to avoid.
    const { reporter, published, advance } = harness();
    reporter.stepStarted(0);
    reporter.stepFinished(0, "First thing.");
    advance(1500);
    reporter.stepStarted(1);
    reporter.toolStarted("call-1", "manage-role", {});
    await reporter.flush();

    expect(published.at(-1)).not.toContain("First thing.");
  });

  test("reports a failed edit without failing the turn", async () => {
    const published: string[] = [];
    const errors: unknown[] = [];
    const reporter = createProgressReporter({
      maxSteps: 12,
      now: () => 0,
      minPublishIntervalMs: 0,
      publish: async () => {
        published.push("attempted");
        throw new Error("discord rate limited");
      },
      onPublishError: (error) => {
        errors.push(error);
      },
    });

    reporter.toolStarted("call-1", "get-activity-stats", {});
    await expect(reporter.flush()).resolves.toBeUndefined();
    expect(published).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  test("counts steps against the budget as each one starts", async () => {
    const { reporter, published, advance } = harness();
    reporter.stepStarted(0);
    advance(1500);
    reporter.stepStarted(1);
    await reporter.flush();

    expect(published.at(-1)).toContain("step 2/12");
  });

  test("advances the displayed step before that step's tool has finished", async () => {
    // The old design bumped the counter in stepFinished, so the very first
    // progress edit under-counted by one - "step 0/12" while a tool from
    // step 1 was already running. onStepStart fires before any of that
    // step's tools do, so the counter has to move there instead.
    const { reporter, published } = harness();
    reporter.stepStarted(0);
    reporter.toolStarted("call-1", "get-activity-stats", {});
    await reporter.flush();

    expect(published.at(-1)).toContain("step 1/12");
  });
});
