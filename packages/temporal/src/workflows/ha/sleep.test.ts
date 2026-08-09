import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { SleepAutomationInput } from "#shared/schemas.ts";
import {
  DEFAULT_SLEEP_AC_DURATION_MINUTES,
  DEFAULT_SLEEP_MUSIC_DURATION_MINUTES,
} from "./sleep.ts";

const TASK_QUEUE = "sleep-automation-test";
const WORKFLOW_TEST_TIMEOUT_MS = 30_000;

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

type ServiceCall = {
  domain: string;
  service: string;
  data: Record<string, unknown>;
};

async function runWorker(
  workflowType: "sleepMusic" | "sleepAc",
  input: SleepAutomationInput | undefined,
  serviceCalls: ServiceCall[],
  workflowId: string,
): Promise<number[]> {
  const serviceCallTimes: number[] = [];
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("../index.ts", import.meta.url).pathname,
    activities: {
      callService: async (
        domain: string,
        service: string,
        data: Record<string, unknown>,
      ): Promise<void> => {
        const time = await testEnv.currentTimeMs();
        serviceCallTimes.push(time);
        serviceCalls.push({ domain, service, data });
      },
    },
  });
  await worker.runUntil(() =>
    testEnv.client.workflow.execute(workflowType, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: input === undefined ? [] : [input],
    }),
  );
  return serviceCallTimes;
}

async function expectInvalidDuration(
  workflowType: "sleepMusic" | "sleepAc",
  durationMinutes: number,
): Promise<void> {
  let failure: unknown;
  try {
    await runWorker(
      workflowType,
      { durationMinutes },
      [],
      `sleep-invalid-${String(durationMinutes)}-${crypto.randomUUID()}`,
    );
  } catch (error: unknown) {
    failure = error;
  }

  if (!(failure instanceof Error)) {
    throw new Error("Expected workflow execution to fail");
  }
  const cause = failure.cause;
  if (!(cause instanceof ApplicationFailure)) {
    throw new TypeError(
      "Expected workflow failure to include an ApplicationFailure cause",
    );
  }
  expect(cause.type).toBe("SleepAutomationDurationError");
  expect(cause.nonRetryable).toBe(true);
}

function expectTimerDuration(
  serviceCallTimes: number[],
  startIndex: number,
  durationMinutes: number,
): void {
  const startedAt = serviceCallTimes[startIndex];
  const finishedAt = serviceCallTimes[startIndex + 1];
  if (startedAt === undefined || finishedAt === undefined) {
    throw new Error("Expected timer boundary timestamps");
  }
  const elapsedMs = finishedAt - startedAt;
  const expectedMs = durationMinutes * 60_000;
  expect(elapsedMs).toBeGreaterThanOrEqual(expectedMs);
  expect(elapsedMs).toBeLessThan(expectedMs + 1000);
}

describe("sleep automation defaults", () => {
  // Spins up two Temporal test workers back to back — more work than any other
  // test here — so it needs the same explicit budget as its siblings. On bun's
  // 5s default it passes on an idle machine and times out under CI load.
  test(
    "use the requested default durations",
    async () => {
      expect(DEFAULT_SLEEP_MUSIC_DURATION_MINUTES).toBe(180);
      expect(DEFAULT_SLEEP_AC_DURATION_MINUTES).toBe(120);
      const musicTimes = await runWorker(
        "sleepMusic",
        undefined,
        [],
        `sleep-music-default-${crypto.randomUUID()}`,
      );
      expectTimerDuration(musicTimes, 2, DEFAULT_SLEEP_MUSIC_DURATION_MINUTES);
      const acTimes = await runWorker(
        "sleepAc",
        undefined,
        [],
        `sleep-ac-default-${crypto.randomUUID()}`,
      );
      expectTimerDuration(acTimes, 0, DEFAULT_SLEEP_AC_DURATION_MINUTES);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});

describe("sleepMusic", () => {
  test(
    "starts the existing sleep media at 10% and stops after the requested duration",
    async () => {
      const serviceCalls: ServiceCall[] = [];
      const serviceCallTimes = await runWorker(
        "sleepMusic",
        { durationMinutes: 90 },
        serviceCalls,
        `sleep-music-${crypto.randomUUID()}`,
      );
      expectTimerDuration(serviceCallTimes, 2, 90);

      expect(serviceCalls).toEqual([
        {
          domain: "media_player",
          service: "unjoin",
          data: { entity_id: "media_player.bedroom" },
        },
        {
          domain: "media_player",
          service: "volume_set",
          data: { entity_id: "media_player.bedroom", volume_level: 0.1 },
        },
        {
          domain: "media_player",
          service: "play_media",
          data: {
            entity_id: "media_player.bedroom",
            media: {
              media_content_id: "FV:2/7",
              media_content_type: "favorite_item_id",
            },
          },
        },
        {
          domain: "media_player",
          service: "media_stop",
          data: { entity_id: "media_player.bedroom" },
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "rejects zero, fractional, and over-24-hour durations",
    async () => {
      for (const durationMinutes of [0, 1.5, 1441]) {
        await expectInvalidDuration("sleepMusic", durationMinutes);
      }
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});

describe("sleepAc", () => {
  test(
    "sets cooling to 24°C and turns the AC off after the requested duration",
    async () => {
      const serviceCalls: ServiceCall[] = [];
      const serviceCallTimes = await runWorker(
        "sleepAc",
        { durationMinutes: 150 },
        serviceCalls,
        `sleep-ac-${crypto.randomUUID()}`,
      );
      expectTimerDuration(serviceCallTimes, 0, 150);

      expect(serviceCalls).toEqual([
        {
          domain: "climate",
          service: "set_temperature",
          data: {
            entity_id: "climate.bedroom",
            temperature: 24,
            hvac_mode: "cool",
          },
        },
        {
          domain: "climate",
          service: "turn_off",
          data: { entity_id: "climate.bedroom" },
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "rejects negative and over-24-hour durations",
    async () => {
      for (const durationMinutes of [-1, 1441]) {
        await expectInvalidDuration("sleepAc", durationMinutes);
      }
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});
