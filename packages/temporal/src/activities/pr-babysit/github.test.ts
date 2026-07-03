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

// Route the two gh reads by URL: the rulesets endpoint vs classic protection.
function stubCapture(classic: CaptureResult): CaptureFn {
  return (args) => {
    const url = args[2] ?? "";
    if (url.includes("rules/branches/")) {
      return Promise.resolve({
        stdout: RULESET_STDOUT,
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

async function loadWithCapture(classic: CaptureResult) {
  void mock.module("./exec.ts", () => ({
    ...actualExec,
    capture: stubCapture(classic),
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
});
