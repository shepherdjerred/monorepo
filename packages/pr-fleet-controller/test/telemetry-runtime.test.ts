import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { trace } from "@opentelemetry/api";
import { loadRunBundle } from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import { createFleetTelemetryRuntime } from "@shepherdjerred/pr-fleet-controller/src/telemetry-runtime.ts";

let stateDirectory: string | undefined;

afterEach(async () => {
  if (stateDirectory !== undefined) {
    await rm(stateDirectory, { recursive: true, force: true });
    stateDirectory = undefined;
  }
});

test("writes and digest-verifies private spans.jsonl", async () => {
  stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-otel-"));
  const recorder = await RunRecorder.create({
    stateDirectory,
    controllerVersion: "0.1.0",
    controllerCommit: "a".repeat(40),
    controllerSourceDirty: false,
    controllerSourceFingerprint: "b".repeat(64),
    model: "gpt-5.6-sol",
    repository: "example/repository",
    checkout: "/repo",
    worktreeRoot: "/repo/worktrees",
    maxWorkers: 1,
  });
  recorder.record("run.started", { test: "storage" });
  const runtime = await createFleetTelemetryRuntime(recorder);
  const span = trace.getTracer("pr-fleet-test").startSpan("gen_ai.chat");
  span.setAttribute("gen_ai.system", "openrouter");
  span.end();
  const spanStats = await stat(recorder.paths.spans);
  expect(spanStats.mode & 0o777).toBe(0o600);
  await runtime.shutdown();
  recorder.requireTelemetryArtifact();
  await recorder.finalize("completed", null);
  const artifacts = await readdir(recorder.paths.runDirectory);
  expect(artifacts).not.toContain("mastra.db");
  expect(artifacts).not.toContain("observability.duckdb");
  expect(await Bun.file(recorder.paths.spans).text()).toContain(
    '"name":"gen_ai.chat"',
  );
  await loadRunBundle(recorder.paths.runDirectory);
});
