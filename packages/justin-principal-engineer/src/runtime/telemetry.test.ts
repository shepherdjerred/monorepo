import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTaskState } from "#src/host/task-state.ts";
import { parseAgentProgress } from "#src/agent/progress.ts";
import type { TaskState } from "#src/domain/schemas.ts";
import { JustinTelemetry, telemetryLogPath } from "./telemetry.ts";
import type { MetricSample } from "./metric-export.ts";
import { runtimePaths } from "./paths.ts";
import { StateStore } from "./state-store.ts";

const tempHomes: string[] = [];

afterEach(async () => {
  for (const home of tempHomes.splice(0)) {
    await rm(home, { force: true, recursive: true });
  }
});

async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "justin-telemetry-"));
  tempHomes.push(home);
  const paths = runtimePaths(home);
  await new StateStore(paths).initialize();
  const state: TaskState = {
    ...createTaskState({
      provider: "codex",
      paths,
      issue: {
        id: "test",
        identifier: "AI-123",
        title: "Private issue title",
        description: "Private issue body",
        priority: 2,
        url: "https://tracker.example/issues/AI-123",
        createdAt: "2026-01-01T00:00:00Z",
        state: { name: "In progress", type: "started" },
        labels: { nodes: [] },
      },
    }),
    phase: "implementing",
  };
  return { paths, state };
}

test("persists totals across runner processes and emits only bounded metrics", async () => {
  const { paths, state } = await fixture();
  const exports: (readonly MetricSample[])[] = [];
  const collect = (samples: readonly MetricSample[]) => {
    exports.push(samples);
    return Promise.resolve();
  };
  const first = new JustinTelemetry(paths, 45, collect);
  await first.begin();
  first.snapshot([state]);
  first.queue({ eligible: 8, openPrs: 2 });
  await first.stage("implementing", state, () => {
    first.progress({
      kind: "turn_completed",
      usage: { input: 9, output: 7, cached_input: 3 },
    });
    first.staleBaseRestack(state, {
      mergeBaseSha: "1".repeat(40),
      mainHeadSha: "2".repeat(40),
      behindBy: 3,
      restackedHeadSha: "3".repeat(40),
      conflict: false,
    });
    return Promise.resolve();
  });
  const passed: TaskState = {
    ...state,
    phase: "passed",
    lastPass: {
      id: crypto.randomUUID(),
      reason: "agent_pass",
      note: "Private pass report",
      closedPullRequest: false,
    },
  };
  await first.finish("success", [passed]);
  const second = new JustinTelemetry(paths, 45, collect);
  await second.begin();
  second.snapshot([passed]);
  await second.finish("success", [passed]);

  const final = exports.at(-1);
  expect(final).toContainEqual({
    name: "justin_codex_tokens_total",
    value: 9,
    labels: { kind: "input" },
    cumulative: true,
  });
  expect(final).toContainEqual({
    name: "justin_reconciles_total",
    value: 2,
    labels: { outcome: "success" },
    cumulative: true,
  });
  expect(final).toContainEqual({
    name: "justin_passes_total",
    value: 1,
    labels: { reason: "agent_pass" },
    cumulative: true,
  });
  expect(final).toContainEqual({
    name: "justin_stale_base_restacks_total",
    value: 1,
    cumulative: true,
  });
  expect(JSON.stringify(exports)).not.toContain("AI-123");
  const eventLog = telemetryLogPath(paths);
  const logs = await Bun.file(eventLog).text();
  expect(logs).toContain('"issue":"AI-123"');
  expect(logs).toContain('"event":"stale_base_restack"');
  expect(logs).not.toContain("Private");
  const logStat = await stat(eventLog);
  expect(logStat.mode & 0o777).toBe(0o600);
});

test("an exporter failure preserves stage outcomes and records a safe local event", async () => {
  const { paths, state } = await fixture();
  const telemetry = new JustinTelemetry(paths, 45, () =>
    Promise.reject(new Error("Exporter secret diagnostic")),
  );
  await telemetry.begin();
  telemetry.snapshot([state]);
  await expect(
    telemetry.stage("implementing", state, () => Promise.resolve("result")),
  ).resolves.toBe("result");
  await telemetry.finish("success", [state]);
  const logs = await Bun.file(telemetryLogPath(paths)).text();
  expect(logs).toContain("telemetry_export_failed");
  expect(logs).toContain('"outcome":"success"');
  expect(logs).not.toContain("Exporter secret diagnostic");
});

test("Codex progress keeps an allowlist of event kinds and typed fields", () => {
  expect(
    parseAgentProgress(
      'JPE_PROGRESS:{"kind":"item_started","item":"command_execution","command":"private"}',
    ),
  ).toEqual({ kind: "item_started", item: "command_execution" });
  expect(
    parseAgentProgress('JPE_PROGRESS:{"kind":"item_started","item":"private"}'),
  ).toBeNull();
  expect(parseAgentProgress("raw command output")).toBeNull();
});
