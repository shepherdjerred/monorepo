import { describe, expect, it, mock } from "bun:test";
import type { CaptureResult } from "./exec.ts";
// Resolve the real module before mock.module runs so `run` and other exports
// keep linking for sibling test files (see agent-task.test.ts for the rationale).
import * as actualExec from "./exec.ts";

const GREPTILE = "buildkite/monorepo/pr/mag-greptile-review";

// Ruleset payload with one required-status-checks rule listing GREPTILE.
const RULESET_STDOUT = JSON.stringify([
  {
    type: "required_status_checks",
    parameters: { required_status_checks: [{ context: GREPTILE }] },
  },
]);

type CaptureFn = (
  args: string[],
  opts?: { env?: Record<string, string> },
) => Promise<CaptureResult>;

// A rulesets payload with no required-status-checks rule (empty required set).
const EMPTY_RULESET_STDOUT = JSON.stringify([]);

// Route the two gh reads by URL: the rulesets endpoint vs classic protection.
function stubCapture(
  classic: CaptureResult,
  rulesetStdout: string = RULESET_STDOUT,
): CaptureFn {
  return (args) => {
    const url = args[2] ?? "";
    if (url.includes("rules/branches/")) {
      return Promise.resolve({
        stdout: rulesetStdout,
        stderr: "",
        exitCode: 0,
      });
    }
    if (url.includes("protection/required_status_checks")) {
      return Promise.resolve(classic);
    }
    throw new Error(`unexpected gh call in test: ${args.join(" ")}`);
  };
}

async function loadWithCapture(
  classic: CaptureResult,
  rulesetStdout: string = RULESET_STDOUT,
) {
  void mock.module("./exec.ts", () => ({
    ...actualExec,
    capture: stubCapture(classic, rulesetStdout),
  }));
  return import("./github.ts");
}

const CTX = { owner: "shepherdjerred", repo: "monorepo", baseRef: "main" };

describe("getRequiredCheckContexts — classic-protection 403", () => {
  it("defers to rulesets when classic protection is 403 (not accessible)", async () => {
    const { getRequiredCheckContexts } = await loadWithCapture({
      stdout: "",
      stderr: "gh: Resource not accessible by integration (HTTP 403)",
      exitCode: 1,
    });
    const result = await getRequiredCheckContexts(CTX);
    // The App token can't read classic protection, but rulesets is
    // authoritative — must NOT fail closed.
    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.contexts).toEqual([GREPTILE]);
    }
  });

  it("still fails closed on a non-permission classic error", async () => {
    const { getRequiredCheckContexts } = await loadWithCapture({
      stdout: "",
      stderr: "gh: something exploded (HTTP 500)",
      exitCode: 1,
    });
    const result = await getRequiredCheckContexts(CTX);
    expect(result.known).toBe(false);
  });

  it("fails closed on 403 when rulesets is ALSO empty (can't confirm zero required checks)", async () => {
    const { getRequiredCheckContexts } = await loadWithCapture(
      {
        stdout: "",
        stderr: "gh: Resource not accessible by integration (HTTP 403)",
        exitCode: 1,
      },
      EMPTY_RULESET_STDOUT,
    );
    const result = await getRequiredCheckContexts(CTX);
    // With classic unreadable (403) AND rulesets empty, we cannot distinguish
    // "no required checks" from "classic held the only ones" — must fail closed
    // rather than let the DoD gate treat the branch as green.
    expect(result.known).toBe(false);
  });
});
