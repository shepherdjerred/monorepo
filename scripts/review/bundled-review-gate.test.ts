import { afterEach, expect, test, vi } from "vitest";
import { runBundledReviewGate } from "./bundled-review-gate.ts";
import { ReviewGateFailure } from "../lib/review/review-gate-poll.ts";
import { REVIEW_GATE_BLOCKED_EXIT_CODE } from "@shepherdjerred/code-review";

afterEach(() => vi.restoreAllMocks());

function environment(): Record<string, string | undefined> {
  return {
    CI_COMMIT_PULL_REQUEST: "123",
    CI_COMMIT_SHA: "a".repeat(40),
    GIT_SHA: "b".repeat(40),
    GITHUB_REVIEW_TOKEN: "test-token",
  };
}

test("the image revision identifies the policy and a clean review passes", async () => {
  vi.spyOn(console, "log").mockImplementation(vi.fn());
  const env = environment();
  const run = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  expect(await runBundledReviewGate(env, run)).toBe(0);
  expect(env["REVIEW_GATE_PARSER_COMMIT"]).toBe(env["GIT_SHA"]);
});

test("only explicit provider quota exhaustion receives the existing exception", async () => {
  vi.spyOn(console, "log").mockImplementation(vi.fn());
  const warning = vi.spyOn(console, "error").mockImplementation(vi.fn());
  expect(
    await runBundledReviewGate(environment(), async () => {
      throw new ReviewGateFailure("quota", REVIEW_GATE_BLOCKED_EXIT_CODE);
    }),
  ).toBe(0);
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining("no review ran"),
  );
  for (const error of [
    new ReviewGateFailure("findings", 1),
    new Error("API unavailable"),
    new Error("timeout"),
  ]) {
    await expect(
      runBundledReviewGate(environment(), async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  }
});

test("missing candidate, policy, or credential inputs cannot skip the gate", async () => {
  for (const name of [
    "CI_COMMIT_PULL_REQUEST",
    "CI_COMMIT_SHA",
    "GIT_SHA",
    "GITHUB_REVIEW_TOKEN",
  ]) {
    const env = environment();
    env[name] = undefined;
    const run = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await expect(runBundledReviewGate(env, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  }
});
