import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  msNumberToTs,
  requiredTsToMs,
  type Timestamp,
} from "@temporalio/common/lib/time.js";
const reads = vi.hoisted(() => ({
  config: vi.fn(),
  client: vi.fn(),
  describe: vi.fn(),
  matching:
    vi.fn<
      (request: {
        namespace: string;
        scheduleId: string;
        startTime?: Timestamp;
        endTime?: Timestamp;
      }) => Promise<{ startTime: Timestamp[] }>
    >(),
}));
vi.mock("#config/promotion.ts", () => ({ promotionConfig: reads.config }));
vi.mock("#client", () => ({ createTemporalReadClient: reads.client }));
import { initialPromotionState } from "#shared/promotion/model.ts";
import { readPromotionPlanningObservation } from "./status-schedule.ts";

const now = Date.parse("2026-11-14T09:00:00Z");
beforeEach(() => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  reads.config.mockResolvedValue({
    available: true,
    enabled: true,
    enabledTargets: ["reddit-mcservers"],
  });
  reads.describe.mockResolvedValue({
    state: { paused: false },
    info: { nextActionTimes: [] },
  });
  reads.matching.mockResolvedValue({
    startTime: [
      msNumberToTs(Date.parse("2026-11-21T00:00:00Z")),
      msNumberToTs(Date.parse("2026-11-22T00:00:00Z")),
    ],
  });
  reads.client.mockResolvedValue({
    connection: {
      withDeadline: (_deadline: number, operation: () => Promise<unknown>) =>
        operation(),
      withAbortSignal: (
        _signal: AbortSignal,
        operation: () => Promise<unknown>,
      ) => operation(),
    },
    schedule: { getHandle: () => ({ describe: reads.describe }) },
    workflowService: { listScheduleMatchingTimes: reads.matching },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("reads one authoritative native range spanning the longest enabled cooldown", async () => {
  const state = {
    ...initialPromotionState("reddit-mcservers", 900),
    nextEligibleAt: "2026-11-21T01:00:00Z",
  };
  const observation = await readPromotionPlanningObservation([state], now);
  expect(observation.schedule).toEqual({
    status: "active",
    times: ["2026-11-21T00:00:00.000Z", "2026-11-22T00:00:00.000Z"],
  });
  expect(reads.client).toHaveBeenCalledWith("prod", { connectTimeout: 4000 });
  expect(reads.matching).toHaveBeenCalledTimes(1);
  const request = reads.matching.mock.calls[0]?.[0];
  expect(requiredTsToMs(request?.startTime, "start")).toBe(now);
  expect(requiredTsToMs(request?.endTime, "end")).toBe(
    Date.parse("2026-11-23T01:00:00Z"),
  );
});

it("does not forecast paused, exhausted or disabled schedules", async () => {
  reads.describe.mockResolvedValueOnce({ state: { paused: true } });
  const paused = await readPromotionPlanningObservation([], now);
  expect(paused.schedule.status).toBe("paused");
  reads.describe.mockResolvedValueOnce({
    state: { paused: false, remainingActions: 0 },
  });
  const exhausted = await readPromotionPlanningObservation([], now);
  expect(exhausted.schedule.status).toBe("exhausted");
  reads.config.mockResolvedValueOnce({
    available: true,
    enabled: false,
    enabledTargets: [],
  });
  const disabled = await readPromotionPlanningObservation([], now);
  expect(disabled.enabled).toBe(false);
  expect(reads.client).toHaveBeenCalledTimes(2);
  expect(reads.matching).not.toHaveBeenCalled();
});

it("caps forecast to remaining native actions and thirty days", async () => {
  reads.describe.mockResolvedValueOnce({
    state: { paused: false, remainingActions: 1 },
  });
  const observation = await readPromotionPlanningObservation(
    [
      {
        ...initialPromotionState("reddit-mcservers", 900),
        nextEligibleAt: "2027-11-21T01:00:00Z",
      },
    ],
    now,
  );
  expect(observation.schedule).toEqual({
    status: "active",
    times: ["2026-11-21T00:00:00.000Z"],
  });
  const request = reads.matching.mock.calls[0]?.[0];
  expect(requiredTsToMs(request?.endTime, "end")).toBe(now + 30 * 86_400_000);
});

it("keeps native read failures explicit while allowing invalid present configuration to fail", async () => {
  reads.describe.mockRejectedValueOnce(new Error("Scheduler unavailable"));
  const unavailable = await readPromotionPlanningObservation([], now);
  expect(unavailable.schedule.status).toBe("unavailable");
  reads.config.mockRejectedValueOnce(new Error("Invalid settings schema"));
  await expect(readPromotionPlanningObservation([], now)).rejects.toThrow(
    "Invalid settings schema",
  );
  reads.config.mockResolvedValueOnce({
    available: true,
    enabled: true,
    enabledTargets: ["pmc", "unknown-target"],
  });
  await expect(readPromotionPlanningObservation([], now)).rejects.toThrow(
    "Unknown promotion target",
  );
});
