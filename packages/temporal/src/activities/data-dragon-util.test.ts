import { describe, expect, test } from "bun:test";
import {
  collectErrorMessages,
  dataDragonPrTitle,
  hasMatchingPrTitle,
  isFinalAttempt,
  resolveTerminalFailureReason,
} from "./data-dragon-util.ts";

describe("isFinalAttempt", () => {
  test("returns false before the final attempt", () => {
    expect(isFinalAttempt(1, 2)).toBe(false);
  });

  test("returns true at the final attempt", () => {
    expect(isFinalAttempt(2, 2)).toBe(true);
  });

  test("returns true past the configured max (defensive)", () => {
    expect(isFinalAttempt(3, 2)).toBe(true);
  });

  test("returns true on the only attempt when maxAttempts is 1", () => {
    expect(isFinalAttempt(1, 1)).toBe(true);
  });
});

describe("hasMatchingPrTitle", () => {
  test("matches an exact title for the target version", () => {
    expect(
      hasMatchingPrTitle(
        [dataDragonPrTitle("16.15.1"), "chore: something unrelated"],
        "16.15.1",
      ),
    ).toBe(true);
  });

  test("does not match a PR for a different version", () => {
    expect(hasMatchingPrTitle([dataDragonPrTitle("16.15.0")], "16.15.1")).toBe(
      false,
    );
  });

  test("does not match on an empty PR list", () => {
    expect(hasMatchingPrTitle([], "16.15.1")).toBe(false);
  });
});

describe("collectErrorMessages", () => {
  test("joins the message and its cause-chain messages", () => {
    const inner = new Error("Command failed (git push origin): exit 1");
    const outer = new Error("Activity task failed", { cause: inner });
    expect(collectErrorMessages(outer)).toBe(
      "Activity task failed | Command failed (git push origin): exit 1",
    );
  });

  test("returns a single message when there is no cause", () => {
    expect(collectErrorMessages(new Error("boom"))).toBe("boom");
  });

  test("returns an empty string for a non-error value", () => {
    expect(collectErrorMessages("not an error")).toBe("");
  });

  test("does not loop on a self-referential cause chain", () => {
    const err = new Error("self");
    Object.defineProperty(err, "cause", { value: err });
    expect(collectErrorMessages(err)).toBe("self");
  });
});

describe("resolveTerminalFailureReason", () => {
  test("extracts the granular reason from a wrapped ActivityFailure chain", () => {
    // Mirrors how Temporal surfaces a failed activity to the workflow: a
    // top-level ActivityFailure whose cause carries the original command
    // message. The reason must come from the buried cause, not the wrapper.
    const activityFailure = new Error("Activity task failed", {
      cause: new Error(
        "Command failed (gh pr create --repo shepherdjerred/monorepo): exit 1 <redacted>",
      ),
    });
    expect(resolveTerminalFailureReason(activityFailure)).toBe(
      "pr-create-failed",
    );
  });

  test("labels a buried git push failure", () => {
    const failure = new Error("Activity task failed", {
      cause: new Error("Command failed (git push --force-with-lease): exit 1"),
    });
    expect(resolveTerminalFailureReason(failure)).toBe("git-push-failed");
  });

  test("falls through to exception for a message-less OOM/timeout kill", () => {
    // A worker killed by OOM / heartbeat timeout carries no granular command
    // message — the reason filter should not match, and the generic
    // ScoutDataDragonUpdateFailed alert covers it.
    expect(
      resolveTerminalFailureReason(new Error("activity StartToClose timeout")),
    ).toBe("exception");
  });
});
