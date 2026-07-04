import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockActivityEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { z } from "zod/v4";
import {
  BabysitIterationResultSchema,
  BabysitVerdictSchema,
  PrBabysitInputSchema,
} from "#shared/pr-babysit/types.ts";
// Static namespace import resolves the real module before mock.module runs, so
// its other exports keep linking for sibling test files (see agent-task.test.ts).
import * as actualIterationCommand from "./iteration-command.ts";

const originalOauthToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
const originalHeartbeatInterval = Bun.env["PR_BABYSIT_HEARTBEAT_INTERVAL_MS"];

// A schema-valid iteration result the fake subprocess emits so the activity
// parses successfully (a no-op iteration: no commits, DoD not self-met).
const FAKE_RESULT = {
  type: "result",
  total_cost_usd: 0,
  num_turns: 1,
  structured_output: {
    summary: "noop test iteration",
    actionsTaken: [],
    committed: false,
    dodMetSelfReport: false,
    needsGuidance: false,
    intentConflict: false,
  },
};

// Replace the real `claude -p` command with a trivial Bun subprocess that emits
// a stream-json init line, stays alive long enough for the heartbeat timer to
// fire at the fast test interval, then emits a valid final result and exits 0.
void mock.module("./iteration-command.ts", () => ({
  ...actualIterationCommand,
  buildBabysitIterationCommand: (): string[] => {
    const code = [
      `console.log(JSON.stringify({ type: "system", subtype: "init" }));`,
      `await Bun.sleep(150);`,
      `console.log(${JSON.stringify(JSON.stringify(FAKE_RESULT))});`,
    ].join("\n");
    return ["bun", "--eval", code];
  },
}));

const input = PrBabysitInputSchema.parse({
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 1353,
  headRef: "feature/test",
});

const verdict = BabysitVerdictSchema.parse({
  headSha: "deadbeef",
  prState: "open",
  ci: {
    green: false,
    failing: ["buildkite/monorepo/pr/mag-greptile-review"],
    pending: [],
    ignoredSoft: [],
    noChecksReported: false,
    missingRequired: [],
  },
  conflicts: { clean: true, paths: [], baseRef: "main" },
  reviews: { allResolved: false, blocking: [], advisory: [] },
  dodMet: false,
  evaluatedAt: "2026-07-03T00:00:00.000Z",
});

describe("runBabysitIteration heartbeat", () => {
  beforeAll(() => {
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-oauth-token";
    // Fast heartbeat so the test doesn't wait the 10s production cadence.
    Bun.env["PR_BABYSIT_HEARTBEAT_INTERVAL_MS"] = "25";
  });

  afterAll(() => {
    if (originalOauthToken === undefined) {
      delete Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
    } else {
      Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = originalOauthToken;
    }
    if (originalHeartbeatInterval === undefined) {
      delete Bun.env["PR_BABYSIT_HEARTBEAT_INTERVAL_MS"];
    } else {
      Bun.env["PR_BABYSIT_HEARTBEAT_INTERVAL_MS"] = originalHeartbeatInterval;
    }
  });

  it("delivers heartbeats to the Temporal activity context", async () => {
    // Import the activity AFTER the command mock is registered so it links the fake.
    const { runBabysitIteration } = await import("./iteration.ts");
    const workdir = await mkdtemp(path.join(os.tmpdir(), "babysit-iter-test-"));

    const env = new MockActivityEnvironment();
    const heartbeats: unknown[] = [];
    env.on("heartbeat", (details) => heartbeats.push(details));

    try {
      // MockActivityEnvironment.run widens the result to `unknown`; narrow it
      // via the schema (no type assertion) rather than annotate.
      const raw = await env.run(async () =>
        runBabysitIteration({ input, verdict, workdir }),
      );

      // Regression guard: onHeartbeat must thread Context.current().heartbeat();
      // before the fix it only logged, so the activity's 60s heartbeatTimeout
      // killed every real iteration.
      expect(heartbeats.length).toBeGreaterThan(0);
      const parsed = z
        .object({ result: BabysitIterationResultSchema })
        .parse(raw);
      expect(parsed.result.summary).toBe("noop test iteration");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});
