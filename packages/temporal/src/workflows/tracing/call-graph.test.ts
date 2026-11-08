import { Client } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  createTemporalClientTracingInterceptor,
  createTemporalWorkerTracing,
} from "@shepherdjerred/temporal-observability/interceptors";
import { createValidatedWorkflowSpanSink } from "@shepherdjerred/temporal-observability/workflow-span-sink";
import { buildTracingResource } from "@shepherdjerred/temporal-observability/tracing-resource";
import { resetOtelGlobals } from "@shepherdjerred/llm-observability/otel-globals";
import { expect, test } from "vitest";
import type { WorkflowInfo } from "@temporalio/workflow";
import type {
  tracingProbeWorkflow,
  tracingReplayProbeWorkflow,
} from "./test-support.ts";

test("exports one real client, Workflow and Activity call graph", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let sdk: NodeSDK | undefined;
  try {
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor(exporter);
    const resource = buildTracingResource(
      "tracing-regression",
      "test",
      "platform",
      {},
    );
    sdk = new NodeSDK({
      resource,
      spanProcessors: [processor],
      logRecordProcessors: [],
    });
    sdk.start();
    const tracing = createTemporalWorkerTracing({
      exporter: createValidatedWorkflowSpanSink(processor, resource),
    });
    const client = new Client({
      connection: environment.client.connection,
      namespace: "default",
      interceptors: { workflow: [createTemporalClientTracingInterceptor()] },
    });
    const taskQueue = "tracing-regression";
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue,
      workflowsPath: new URL("test-support.ts", import.meta.url).pathname,
      activities: { probe: () => Promise.resolve("ok") },
      interceptors: {
        workflowModules: tracing.workflowModules,
        activity: tracing.activity,
      },
      sinks: tracing.sinks,
    });
    await expect(
      worker.runUntil(() =>
        client.workflow.execute<typeof tracingProbeWorkflow>(
          "tracingProbeWorkflow",
          {
            workflowId: "tracing-regression-" + crypto.randomUUID(),
            taskQueue,
            args: [],
          },
        ),
      ),
    ).resolves.toBe("ok");

    const spans = exporter.getFinishedSpans();
    const names = [
      "StartWorkflow:tracingProbeWorkflow",
      "RunWorkflow:tracingProbeWorkflow",
      "StartActivity:probe",
      "RunActivity:probe",
    ];
    const chain = names.map((name) => {
      const span = spans.find((candidate) => candidate.name === name);
      expect(span, name).toBeDefined();
      if (!span) throw new Error("Missing required call-graph span: " + name);
      return span;
    });
    expect(new Set(chain.map((span) => span.spanContext().traceId)).size).toBe(
      1,
    );
    for (let index = 1; index < chain.length; index++) {
      expect(chain[index]?.parentSpanContext?.spanId).toBe(
        chain[index - 1]?.spanContext().spanId,
      );
    }
    expect(chain[1]?.attributes).toMatchObject({
      "temporal.workflow_type": "tracingProbeWorkflow",
    });
  } finally {
    await environment.teardown();
    await sdk?.shutdown();
    resetOtelGlobals();
  }
}, 60_000);

test("tracing replays an untraced history without changing UUIDs or exporting replay spans", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const observedIds: string[] = [];
  const uuidCapture = {
    record: {
      callDuringReplay: true,
      fn: (_info: WorkflowInfo, id: string) => {
        observedIds.push(id);
      },
    },
  };
  const workflowsPath = new URL("test-support.ts", import.meta.url).pathname;
  try {
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: "untraced-history",
      workflowsPath,
      activities: { capture: (id: string) => Promise.resolve(id) },
      sinks: { uuidCapture },
    });
    const original = await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start<
        typeof tracingReplayProbeWorkflow
      >("tracingReplayProbeWorkflow", {
        workflowId: "untraced-history-" + crypto.randomUUID(),
        taskQueue: "untraced-history",
        args: [],
      });
      return {
        id: await handle.result(),
        history: await handle.fetchHistory(),
      };
    });
    const exporter = new InMemorySpanExporter();
    const tracing = createTemporalWorkerTracing({
      exporter: createValidatedWorkflowSpanSink(
        new SimpleSpanProcessor(exporter),
        buildTracingResource("replay-test", "test", "platform", {}),
      ),
    });
    await Worker.runReplayHistory(
      {
        workflowsPath,
        interceptors: { workflowModules: tracing.workflowModules },
        sinks: { ...tracing.sinks, uuidCapture },
      },
      original.history,
    );
    expect(observedIds).toEqual([original.id, original.id]);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  } finally {
    await environment.teardown();
  }
}, 60_000);
