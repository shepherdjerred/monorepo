import { afterEach, expect, test } from "vitest";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { trace } from "@opentelemetry/api";
import { loadRunBundle } from "@shepherdjerred/pr-fleet-controller/src/run-inspection.ts";
import { RunRecorder } from "@shepherdjerred/pr-fleet-controller/src/run-recorder.ts";
import { createFleetTelemetryRuntime } from "@shepherdjerred/pr-fleet-controller/src/telemetry-runtime.ts";
import { resetOtelGlobals } from "@shepherdjerred/llm-observability/otel-globals";

let stateDirectory: string | undefined;

afterEach(async () => {
  if (stateDirectory !== undefined) {
    await rm(stateDirectory, { recursive: true, force: true });
    stateDirectory = undefined;
  }
  // This suite registers process-global OpenTelemetry state. Leaving it
  // registered leaks into every other file in the same worker, where the
  // symptom is silent: later spans route into a shut-down processor whose
  // target directory this hook just deleted.
  resetOtelGlobals();
});

async function createRecorder(): Promise<RunRecorder> {
  stateDirectory = await mkdtemp(path.join(tmpdir(), "pr-fleet-otel-"));
  return await RunRecorder.create({
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
}

test("a second runtime can register after the first shuts down", async () => {
  // setGlobalTracerProvider is one-shot while a provider stays registered, so
  // a shutdown that only disables the context manager makes every later
  // runtime in the process throw "already registered" — and any span emitted
  // in between lands in the dead processor.
  const firstRecorder = await createRecorder();
  const first = await createFleetTelemetryRuntime(firstRecorder);
  await first.shutdown();

  const secondRecorder = await createRecorder();
  const second = await createFleetTelemetryRuntime(secondRecorder);
  const span = trace.getTracer("pr-fleet-test").startSpan("gen_ai.chat");
  span.setAttribute("gen_ai.system", "openrouter");
  span.end();
  await second.shutdown();

  // The span must be in the SECOND runtime's file: routing into the first,
  // shut-down processor is the failure this guards, and it is silent.
  expect(await Bun.file(secondRecorder.paths.spans).text()).toContain(
    '"name":"gen_ai.chat"',
  );
  await rm(firstRecorder.paths.runDirectory, { recursive: true, force: true });
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
