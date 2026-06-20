/**
 * End-to-end local-Temporal test for the alert-remediation agent path.
 *
 * Boots a REAL local Temporal server (`TestWorkflowEnvironment.createLocal()`,
 * real time — not the time-skipping env), runs a REAL worker with the REAL
 * `runAlertRemediationAgent` activity, and exercises the full
 * worker → activity → subprocess → stream-json parse → workflow-result loop.
 *
 * The subprocess is a FAKE `claude` shim injected via PATH (no prod change —
 * `agentEnv` passes PATH through), so the test is hermetic: no real model,
 * network, or credentials. It proves the new `--output-format stream-json`
 * pipeline (NDJSON streaming + `parseClaudeResultMessage` NDJSON parsing +
 * `extractJsonPayload`) works through genuine Temporal plumbing.
 *
 * Excluded from the default `bun test` glob (lives at src root, like
 * `integration.test.ts`); run via `bun run test:e2e`. mock.module is
 * process-wide, but this file runs in its own process so there is no leak.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { Client } from "@temporalio/client";
import * as realToken from "#lib/github-app-token.ts";

// Mock the GitHub App token mint BEFORE the activity module is imported, so
// the real activity gets a dummy token instead of calling GitHub. Spread the
// real exports so sibling imports of this module keep working.
void mock.module("#lib/github-app-token.ts", () => ({
  ...realToken,
  createGitHubAppInstallationToken: () =>
    Promise.resolve({ token: "dummy-installation-token" }),
}));

const TASK_QUEUE = "alert-remediation-e2e";

const AGENT_PAYLOAD = {
  outcome: "report-only",
  decision: "diagnosed",
  reason: "Synthetic e2e alert — no repository fix needed.",
  markdown: "## Diagnosis\n\nReport-only e2e run.",
  verificationCommands: [],
};

/** Write an executable `claude` shim that emits stream-json NDJSON. */
async function writeFakeClaude(dir: string): Promise<void> {
  const lines = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "diagnosing" },
          { type: "tool_use", name: "Read" },
        ],
      },
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 1,
      // `--json-schema` puts the validated object in `structured_output`;
      // `result` is the model's prose.
      result: "Diagnosed the synthetic alert — report only.",
      structured_output: AGENT_PAYLOAD,
    }),
  ];
  // Single-quoted heredoc → the JSON (with its escaped quotes) is emitted
  // verbatim, regardless of the args claude was invoked with.
  const shim = `#!/bin/sh\ncat <<'CLAUDE_NDJSON'\n${lines.join("\n")}\nCLAUDE_NDJSON\n`;
  const shimPath = path.join(dir, "claude");
  await Bun.write(shimPath, shim);
  await Bun.spawn(["chmod", "+x", shimPath]).exited;
}

let testEnv: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;
let client: Client;
let shimDir: string;
let workdir: string;
const originalPath = Bun.env["PATH"];
const originalToken = Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];

beforeAll(async () => {
  shimDir = await mkdtemp(path.join(tmpdir(), "fake-claude-"));
  workdir = await mkdtemp(path.join(tmpdir(), "alert-remediation-wd-"));
  await writeFakeClaude(shimDir);
  Bun.env["PATH"] = `${shimDir}:${originalPath ?? ""}`;
  Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = "dummy-oauth-token";

  testEnv = await TestWorkflowEnvironment.createLocal();
  const { alertRemediationActivities } =
    await import("#activities/alert-remediation.ts");

  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("workflows/index.ts", import.meta.url).pathname,
    activities: {
      ...alertRemediationActivities,
      // Stub the peripheral activities (GitHub / git / email); keep the REAL
      // runAlertRemediationAgent so the fake claude subprocess actually runs.
      findExistingAlertRemediationPr: () => Promise.resolve({ found: false }),
      prepareAlertRemediationWorkdir: () => Promise.resolve({ workdir }),
      cleanupAlertRemediationWorkdir: () => Promise.resolve(),
    },
  });
  workerRun = worker.run();
  client = testEnv.client;
}, 120_000);

afterAll(async () => {
  worker.shutdown();
  await workerRun;
  await testEnv.teardown();
  Bun.env["PATH"] = originalPath;
  if (originalToken === undefined) {
    delete Bun.env["CLAUDE_CODE_OAUTH_TOKEN"];
  } else {
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"] = originalToken;
  }
  await rm(shimDir, { recursive: true, force: true });
  await rm(workdir, { recursive: true, force: true });
});

describe("alert-remediation local-Temporal e2e", () => {
  it("runs the child workflow: real activity → stream-json subprocess → parsed result", async () => {
    const result = await client.workflow.execute(
      "alertRemediationChildWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId: `alert-remediation-e2e-${crypto.randomUUID()}`,
        args: [
          {
            alert: {
              source: "pagerduty",
              fingerprint: "pagerduty:E2E",
              title: "E2E synthetic alert",
              status: "triggered",
              severity: "high",
              url: "https://example.com/E2E",
              details: {},
            },
            repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
            provider: "claude",
            maxTurns: 5,
          },
        ],
      },
    );

    // The outcome came back through: real worker → real runAlertRemediationAgent
    // → Bun.spawn(fake claude, stream-json) → parseClaudeResultMessage(NDJSON)
    // → extractJsonPayload → AlertRemediationAgentPayloadSchema.
    expect(result.outcome).toBe("report-only");
    expect(result.decision).toBe("diagnosed");
    expect(result.source).toBe("pagerduty");
    expect(result.fingerprint).toBe("pagerduty:E2E");
    expect(result.markdown).toContain("Diagnosis");
  }, 60_000);
});
