import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import {
  NativeCompensationActivityInputSchema,
  type NativeCompensationNetworkActivities,
} from "@shepherdjerred/media/native-compensation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { compensationCall } from "#activities/media/compensation-execution.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
const modes = {
  prepare: "prepareNativeCompensationWorkflow",
  apply_lost_ack: "applyNativeCompensationWorkflow",
  compensate_lost_ack: "compensateNativePublicationWorkflow",
  protected: "compensateNativePublicationWorkflow",
  publish_waiting: "publishCompensatedMediaWorkflow",
  publish_lost_ack: "publishCompensatedMediaWorkflow",
} as const;

test.each([
  "prepare",
  "apply_lost_ack",
  "compensate_lost_ack",
  "protected",
  "publish_waiting",
  "publish_lost_ack",
] as const)(
  "compensation %s routes exact commands and replays",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let planState = "preparing";
    let physicalState = "pending";
    let verified = false;
    let physicalCalls = 0;
    let publicationCalls = 0;
    let observations = 0;
    const finished: unknown[] = [];
    const input = {
      planId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      planHash: "a".repeat(64),
    };
    const activity = {
      schemaVersion: 1,
      continuationId: crypto.randomUUID(),
      operationId: input.operationId,
      recoveryEpoch: 2,
    };
    const network = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        nativeRecoveryState: () =>
          Promise.resolve({
            state: planState,
            applied: planState === "applied",
          }),
        nativeCompensationState: (raw: unknown) => {
          expect(NativeCompensationActivityInputSchema.parse(raw)).toEqual(
            activity,
          );
          return Promise.resolve({
            state: physicalState,
            publicationVerified: verified,
          });
        },
        observeNativeCompensation: () =>
          compensationCall(() => {
            observations++;
            return Promise.resolve();
          }),
        observeNativeCompensationExecution: (raw: unknown) =>
          compensationCall(() => {
            expect(NativeCompensationActivityInputSchema.parse(raw)).toEqual(
              activity,
            );
            observations++;
            return Promise.resolve(
              mode === "protected"
                ? {
                    status: "protected",
                    reason: "compensation_playback_active_or_unknown",
                  }
                : { status: "ready", reason: null },
            );
          }),
        publishCompensatedMedia: (raw: unknown) =>
          compensationCall(
            (): ReturnType<
              NativeCompensationNetworkActivities["publishCompensatedMedia"]
            > => {
              expect(NativeCompensationActivityInputSchema.parse(raw)).toEqual(
                activity,
              );
              expect(Context.current().info.scheduleToCloseTimeoutMs).toBe(
                300_000,
              );
              publicationCalls++;
              if (mode === "publish_waiting" && publicationCalls === 1)
                return Promise.resolve({
                  status: "waiting",
                  reason: "plex_scan_pending",
                });
              verified = true;
              if (mode === "publish_lost_ack")
                throw new Error("CAPABILITY_CANARY lost acknowledgement");
              return Promise.resolve({ status: "available", reason: null });
            },
          ),
        finishMediaOperation: (value: unknown) => {
          finished.push(value);
          return Promise.resolve();
        },
      },
    });
    const files = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: {
        prepareNativeCompensationFiles: () =>
          compensationCall(() => {
            physicalCalls++;
            planState = "awaiting_review";
            return Promise.resolve();
          }),
        applyNativeCompensationFiles: () =>
          compensationCall(() => {
            physicalCalls++;
            planState = "applied";
            throw new Error("CAPABILITY_CANARY apply lost acknowledgement");
          }),
        compensateNativePublicationFiles: (raw: unknown) =>
          compensationCall(() => {
            expect(NativeCompensationActivityInputSchema.parse(raw)).toEqual(
              activity,
            );
            expect(Context.current().info.heartbeatTimeoutMs).toBe(60_000);
            physicalCalls++;
            physicalState = "compensated";
            throw new Error(
              "CAPABILITY_CANARY inverse completion lost acknowledgement",
            );
          }),
      },
    });
    const workflow = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const running = [network.run(), files.run()];
    try {
      const command =
        mode === "prepare" || mode === "apply_lost_ack" ? input : activity;
      const handle = await environment.client.workflow.start(modes[mode], {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ ...command, kind: "queue-envelope-only" }],
      });
      await workflow.runUntil(handle.result());
      expect(finished).toEqual([
        {
          operationId: input.operationId,
          status: mode === "protected" ? "reconciling" : "completed",
          reason:
            mode === "protected"
              ? "compensation_playback_active_or_unknown"
              : null,
        },
      ]);
      if (mode === "protected") expect(physicalCalls).toBe(0);
      if (mode === "prepare") expect(physicalCalls).toBe(1);
      if (mode === "apply_lost_ack" || mode === "compensate_lost_ack")
        expect(physicalCalls).toBe(2);
      if (mode.startsWith("publish")) {
        expect(publicationCalls).toBe(2);
        expect(physicalCalls).toBe(0);
      } else expect(observations).toBeGreaterThan(0);
      const history = await handle.fetchHistory();
      expect(JSON.stringify(history)).not.toContain("CAPABILITY_CANARY");
      if (mode === "publish_waiting") {
        const events = history.events ?? [];
        expect(
          events.some((event) => event.timerFiredEventAttributes != null),
        ).toBe(true);
      }
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      network.shutdown();
      files.shutdown();
      await Promise.all(running);
      await environment.teardown();
    }
  },
  60_000,
);
