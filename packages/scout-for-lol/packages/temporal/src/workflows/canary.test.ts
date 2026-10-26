import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { defaultPayloadConverter } from "@temporalio/common";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  ScoutBackgroundJobInputSchema,
  ScoutActiveBackgroundJobKindSchema,
  SCOUT_BACKGROUND_JOB_KINDS_V1,
  ScoutQueueCanaryProbeResultSchema,
  type ScoutQueueCanaryInput,
  type ScoutQueueCanaryProbeInput,
  type ScoutQueueCanaryProbeResult,
} from "#src/contracts.ts";
import { scoutTaskQueues } from "#src/identifiers.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

let environment: TestWorkflowEnvironment;
const pool = createScoutWorkerPool();
const queues = scoutTaskQueues("dev");
const workflowsPath = new URL("index.ts", import.meta.url).pathname;
const capabilityPatch = "scout-queue-canary-background-kinds-v3";
type History = Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>;

function hasCapabilityPatch(
  history: History,
  patchId = capabilityPatch,
): boolean {
  return (history.events ?? []).some((event) => {
    const marker = event.markerRecordedEventAttributes;
    return (
      marker?.markerName === "core_patch" &&
      Object.values(marker.details ?? {}).some((payloads) =>
        payloads.payloads?.some((payload) => {
          const data: unknown = JSON.parse(
            new TextDecoder().decode(payload.data ?? new Uint8Array()),
          );
          return (
            typeof data === "object" &&
            data !== null &&
            "id" in data &&
            data.id === patchId
          );
        }),
      )
    );
  });
}

/** Compile the retained pre-patch branch without recording the new marker. */
async function legacyWorkflowBundle(v2 = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-canary-legacy-"));
  const loader = path.join(directory, "pre-patch.cjs");
  try {
    await writeFile(
      loader,
      String.raw`module.exports = function(source) {
      const marker = /patched\(\s*["']scout-queue-canary-background-kinds-v[23]["']\s*\)/g;
      if ((source.match(marker) || []).length !== 2) throw Error("Expected exact retained patch boundary");
      return source.replace(marker, match => match.includes("v3") || !${JSON.stringify(v2)} ? "false" : match);
    };`,
    );
    return await bundleWorkflowCode({
      workflowsPath,
      webpackConfigHook: (config) => {
        config.module ??= {};
        config.module.rules ??= [];
        config.module.rules.push({
          test: /[/\\]canary\.ts$/u,
          enforce: "pre",
          use: [{ loader }],
        });
        return config;
      },
    });
  } finally {
    await rm(directory, { recursive: true });
  }
}

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
  await pool.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: queues.workflow,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    }),
  );
  for (const queueClass of [
    "realtime",
    "interactive",
    "background",
    "lake",
    "gateway",
  ] as const) {
    await pool.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: queues[queueClass],
        activities: {
          probeQueue: (input: ScoutQueueCanaryProbeInput) =>
            Promise.resolve({
              ...input,
              taskQueue: queues[queueClass],
            }),
        },
      }),
    );
  }
}, 60_000);

afterEach(async () => {
  await pool.drain();
  await environment.teardown();
});

function execute(
  input: ScoutQueueCanaryInput,
): Promise<ScoutQueueCanaryProbeResult[]> {
  return environment.client.workflow.execute("scoutQueueCanaryWorkflow", {
    taskQueue: queues.workflow,
    workflowId: `canary-${input.canaryId}`,
    args: [input],
  });
}

test("reports candidate-compiled capabilities instead of echoing the requested subset", async () => {
  const input = {
    stage: "dev",
    canaryId: "capabilities",
    backgroundJobKinds: ["support-inbox"],
  } as const;
  const handle = await environment.client.workflow.start(
    "scoutQueueCanaryWorkflow",
    {
      taskQueue: queues.workflow,
      workflowId: "canary-capabilities",
      args: [input],
    },
  );
  const results = z
    .array(ScoutQueueCanaryProbeResultSchema)
    .parse(await handle.result());
  expect(results).toHaveLength(4);
  for (const result of results) {
    expect(result.backgroundJobKinds).toEqual(
      ScoutActiveBackgroundJobKindSchema.options,
    );
    expect(result.backgroundJobKinds).toContain("outreach");
  }
  const history = await handle.fetchHistory();
  expect(hasCapabilityPatch(history)).toBe(true);
  await Worker.runReplayHistory({ workflowsPath }, history);
  for (const kind of ["custom-nights-expiry", "unknown-job"]) {
    expect(
      ScoutBackgroundJobInputSchema.safeParse({ stage: "dev", kind }).success,
    ).toBe(false);
    const invalid = structuredClone(history);
    const started =
      invalid.events?.[0]?.workflowExecutionStartedEventAttributes;
    if (!started) throw new Error("Recorded Workflow input absent");
    started.input = {
      payloads: [
        defaultPayloadConverter.toPayload({
          ...input,
          backgroundJobKinds: [kind],
        }),
      ],
    };
    await expect(
      Worker.runReplayHistory({ workflowsPath }, invalid),
    ).rejects.toThrow();
  }
}, 120_000);

test.each([false, true])(
  "replays a completed retained canary with its original capabilities (v2: %s)",
  async (v2) => {
    const retainedKinds = SCOUT_BACKGROUND_JOB_KINDS_V1.filter(
      (kind) => !v2 || kind !== "custom-nights-expiry",
    );
    await pool.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: "legacy-canary",
        workflowBundle: await legacyWorkflowBundle(v2),
      }),
    );
    const handle = await environment.client.workflow.start(
      "scoutQueueCanaryWorkflow",
      {
        taskQueue: "legacy-canary",
        workflowId: "canary-legacy-capabilities",
        args: [
          {
            stage: "dev",
            canaryId: "legacy-capabilities",
            includeGateway: true,
            backgroundJobKinds: retainedKinds,
          },
        ],
      },
    );
    const results = z
      .array(ScoutQueueCanaryProbeResultSchema)
      .parse(await handle.result());
    expect(results).toHaveLength(5);
    for (const result of results)
      expect(result.backgroundJobKinds).toEqual(retainedKinds);
    const history = await handle.fetchHistory();
    expect(hasCapabilityPatch(history)).toBe(false);
    expect(
      hasCapabilityPatch(history, "scout-queue-canary-background-kinds-v2"),
    ).toBe(v2);
    expect(
      history.events?.at(-1)?.workflowExecutionCompletedEventAttributes,
    ).toBeDefined();
    await Worker.runReplayHistory({ workflowsPath }, history);
  },
  120_000,
);

test("preserves the response for histories without the optional capability request", async () => {
  const results = await execute({ stage: "dev", canaryId: "legacy" });
  expect(results).toHaveLength(4);
  for (const result of results)
    expect(result.backgroundJobKinds).toBeUndefined();
}, 30_000);

test("explicitly proves the gateway queue when Customs durability is requested", async () => {
  const results = await execute({
    stage: "dev",
    canaryId: "gateway",
    includeGateway: true,
  });
  expect(results).toHaveLength(5);
  expect(results).toContainEqual({
    stage: "dev",
    canaryId: "gateway",
    includeGateway: true,
    queueClass: "gateway",
    taskQueue: "scout-dev-gateway",
    backgroundJobKinds: undefined,
  });
}, 30_000);
