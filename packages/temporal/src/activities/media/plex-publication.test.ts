import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { NativeCompensationActivityInputSchema } from "@shepherdjerred/media/native-compensation";
import {
  createPlexPublicationActivities,
  createPlexCompensatedPublication,
} from "./plex-publication.ts";

afterEach(() => vi.restoreAllMocks());

function environment(at: number) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    scheduleToCloseTimeoutMs: 180_000,
    startToCloseTimeoutMs: 120_000,
    heartbeatTimeoutMs: 30_000,
  });
}

const input = {
  operationId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  mediaId: "00000000-0000-4000-8000-000000000003",
  generation: 1,
};
const compensationInput = NativeCompensationActivityInputSchema.parse({
  schemaVersion: 1,
  operationId: input.operationId,
  continuationId: "00000000-0000-4000-8000-000000000004",
  recoveryEpoch: 1,
});

test.each([
  "publishMediaToPlex",
  "publishRestoredMedia",
  "publishRolledBackMedia",
] as const)(
  "%s retains its original proof budget across lazy initialization",
  async (method) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const dispatch = vi.fn(
      (_input: unknown, execution: PlexBindingExecution) => {
        expect(execution.observed.wall).toBe(at);
        expect(execution.expiresAtMs).toBe(at + 60_000);
        expect(Date.now()).toBeGreaterThan(execution.expiresAtMs);
        execution.assertActive();
        // The real consumer checks proof expiry; the adapter must not renew it.
        return Promise.resolve({
          status: "blocked" as const,
          reason: "expired_proof",
        });
      },
    );
    const activities = createPlexPublicationActivities(() => {
      clock.mockReturnValue(at + 61_000);
      return Promise.resolve({
        plexBinding: {
          publishMediaToPlex: dispatch,
          publishRestoredMedia: dispatch,
          publishRolledBackMedia: dispatch,
        },
      });
    });
    await expect(
      environment(at).run(activities[method], input),
    ).resolves.toEqual({ status: "blocked", reason: "expired_proof" });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(input, expect.any(Object));
  },
);

test("compensated publication can read its immutable ACK after proof expiry with both SDK guards retained", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const activity = createPlexCompensatedPublication(() => {
    clock.mockReturnValue(at + 61_000);
    return Promise.resolve({
      plexBinding: {
        publishCompensatedMedia: (received, execution, compensation) => {
          expect(received).toEqual(compensationInput);
          expect(execution.observed.wall).toBe(at);
          expect(execution.expiresAtMs).toBe(at + 60_000);
          expect(compensation.signal).toBe(execution.signal);
          execution.assertActive();
          compensation.assertActive();
          return Promise.resolve({
            status: "available" as const,
            reason: null,
          });
        },
      },
    });
  });
  await expect(
    environment(at).run(activity, compensationInput),
  ).resolves.toEqual({ status: "available", reason: null });
});

test("compensated publication refuses dispatch if lazy initialization consumes the actual SDK deadline", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const dispatch = vi.fn(() =>
    Promise.resolve({ status: "available" as const, reason: null }),
  );
  const activity = createPlexCompensatedPublication(() => {
    clock.mockReturnValue(at + 120_000);
    return Promise.resolve({
      plexBinding: { publishCompensatedMedia: dispatch },
    });
  });
  await expect(
    environment(at).run(activity, compensationInput),
  ).rejects.toThrow("Plex binding Activity failed");
  expect(dispatch).not.toHaveBeenCalled();
});
