import { MockActivityEnvironment } from "@temporalio/testing";
import { ApplicationFailure } from "@temporalio/activity";
import { FileOperationConflict } from "@shepherdjerred/media/filesystem/operations-types";
import { expect, test, vi } from "vitest";
import {
  compensationCall,
  compensationExecution,
  compensationRuntimeCall,
} from "./compensation-execution.ts";

function environment(at = Date.now()) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 300_000,
  });
}
test.each([60_000, 300_000])(
  "numeric compensation deadline retains original SDK minimum with overall %i",
  async (overall) => {
    const at = Date.now();
    const env = new MockActivityEnvironment({
      scheduledTimestampMs: at,
      currentAttemptScheduledTimestampMs: at + 10,
      startToCloseTimeoutMs: 120_000,
      scheduleToCloseTimeoutMs: overall,
    });
    await env.run(async () => {
      const execution = compensationExecution();
      const expected = Math.min(at + overall, at + 10 + 120_000);
      expect(execution.expiresAtMs).toBe(expected);
      await execution.checkpoint("original-numeric-deadline");
      expect(execution.expiresAtMs).toBe(expected);
    });
  },
);
test.each([undefined, NaN, Infinity, -Infinity, 0, -1])(
  "invalid compensation budget %s rejects before bootstrap",
  async (value) => {
    const env = environment();
    Object.defineProperty(env.context.info, "scheduleToCloseTimeoutMs", {
      value,
    });
    const load = vi.fn(() => Promise.resolve({}));
    await expect(
      env.run(() => compensationRuntimeCall(load, () => Promise.resolve())),
    ).rejects.toThrow("Compensation Activity failed");
    expect(load).not.toHaveBeenCalled();
  },
);
test("expiry during lazy initialization prevents the real activity boundary", async () => {
  const env = environment();
  const work = vi.fn(() => Promise.resolve("effect"));
  const clock = vi.spyOn(performance, "now");
  try {
    await expect(
      env.run(() =>
        compensationRuntimeCall(async () => {
          await Promise.resolve();
          clock.mockReturnValue(performance.now() + 120_001);
          return {};
        }, work),
      ),
    ).rejects.toThrow("Compensation Activity failed");
    expect(work).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
test("a waited lock that consumes the deadline cannot proceed or return success", async () => {
  const env = environment();
  const clock = vi.spyOn(performance, "now");
  const effect = vi.fn();
  try {
    await expect(
      env.run(() =>
        compensationCall(async (execution) => {
          await Promise.resolve();
          clock.mockReturnValue(performance.now() + 120_001);
          execution.assertActive();
          effect();
        }),
      ),
    ).rejects.toThrow("Compensation Activity failed");
    expect(effect).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
test("runtime factory obtains distinct current invocation cancellation signals", async () => {
  const first = environment();
  const signal = await first.run(() =>
    Promise.resolve(compensationExecution().signal),
  );
  first.cancel();
  await environment().run(async () => {
    const execution = compensationExecution();
    expect(execution.signal).not.toBe(signal);
    await execution.checkpoint("new-invocation");
  });
});
test("cancelled or private failures never publish a successful acknowledgement or raw detail", async () => {
  const env = environment();
  await expect(
    env.run(() =>
      compensationCall(async () => {
        env.cancel();
        await Promise.resolve();
        return "late";
      }),
    ),
  ).rejects.toThrow("cancelled");
  await expect(
    environment().run(() =>
      compensationCall(() =>
        Promise.reject(new Error("CAPABILITY_CANARY private path")),
      ),
    ),
  ).rejects.toMatchObject({
    message: "Compensation Activity failed; review protected operation status",
    cause: undefined,
    details: undefined,
  });
});

test.each([
  {
    name: "unproven partial",
    error: () =>
      new FileOperationConflict("Unproven import partial requires recovery"),
    diagnostic: { schemaVersion: 1, code: "staging_partial_unproven" },
  },
  {
    name: "native identity",
    error: () =>
      new FileOperationConflict(
        "Media file identity changed after verification",
      ),
    diagnostic: { schemaVersion: 1, code: "native_file_identity_changed" },
  },
  {
    name: "unknown private conflict",
    error: () =>
      new FileOperationConflict(
        "CAPABILITY_CANARY /private/token-bearing-path",
      ),
    diagnostic: { schemaVersion: 1, code: "file_operation_conflict" },
  },
  {
    name: "filesystem errno",
    error: () =>
      Object.assign(new Error("CAPABILITY_CANARY /private/path"), {
        code: "ENOSPC",
        path: "/private/token",
        cause: new Error("PRIVATE_CAUSE"),
      }),
    diagnostic: { schemaVersion: 1, code: "filesystem_error", errno: "ENOSPC" },
  },
  {
    name: "allowed guard",
    error: () =>
      Object.assign(new Error("CAPABILITY_CANARY"), {
        name: "FileGuardError",
        reason: "reservation_obsolete",
      }),
    diagnostic: {
      schemaVersion: 1,
      code: "file_guard_rejected",
      reason: "reservation_obsolete",
    },
  },
  {
    name: "original local invocation expiry",
    error: () =>
      ApplicationFailure.create({
        message: "CAPABILITY_CANARY",
        type: "MediaPublicationInvocationExpired",
        nonRetryable: true,
        details: ["PRIVATE_DETAIL"],
      }),
    diagnostic: { schemaVersion: 1, code: "publication_invocation_expired" },
  },
  {
    name: "original SDK deadline",
    error: () =>
      ApplicationFailure.create({
        message: "CAPABILITY_CANARY",
        type: "CompensationDeadlineExceeded",
      }),
    diagnostic: { schemaVersion: 1, code: "sdk_deadline_exceeded" },
  },
])(
  "$name emits only finite diagnostic facts without changing failure/retry semantics",
  async ({ error, diagnostic }) => {
    await expect(
      environment().run(() => compensationCall(() => Promise.reject(error()))),
    ).rejects.toMatchObject({
      message:
        "Compensation Activity failed; review protected operation status",
      type: "CompensationActivityFailure",
      nonRetryable: false,
      cause: undefined,
      details: [diagnostic],
    });
    try {
      await environment().run(() =>
        compensationCall(() => Promise.reject(error())),
      );
    } catch (error_) {
      expect(JSON.stringify(error_)).not.toMatch(
        /CAPABILITY_CANARY|PRIVATE_CAUSE|PRIVATE_DETAIL|token-bearing-path|\/private\/path/u,
      );
    }
  },
);

test.each([
  Object.assign(new Error("CAPABILITY_CANARY"), {
    name: "FileGuardError",
    reason: "CAPABILITY_CANARY",
  }),
  Object.assign(new Error("CAPABILITY_CANARY"), {
    code: "ENOSPC_CAPABILITY_CANARY",
  }),
  ApplicationFailure.create({
    message: "CAPABILITY_CANARY",
    type: "UnapprovedFailure",
    details: ["PRIVATE_DETAIL"],
  }),
])(
  "unknown failure metadata stays absent from protected history",
  async (error) => {
    await expect(
      environment().run(() => compensationCall(() => Promise.reject(error))),
    ).rejects.toMatchObject({
      type: "CompensationActivityFailure",
      cause: undefined,
      details: undefined,
    });
  },
);
