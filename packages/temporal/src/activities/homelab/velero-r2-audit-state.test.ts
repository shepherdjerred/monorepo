import { expect, test } from "vitest";
import { register } from "#observability/metrics.ts";
import { retryUntilReady } from "#shared/startup-retry.ts";
import {
  isTransientR2AuditStateError,
  publishVeleroR2AuditState,
  recordVeleroR2AuditState,
  restoreVeleroR2AuditMetrics,
  type AuditStateStore,
} from "./velero-r2-audit-state.ts";
import type { V1ConfigMap } from "@kubernetes/client-node";

test.each([408, 429, 500, 502, 503, 504])(
  "retries Kubernetes status %s",
  (code) => {
    expect(
      isTransientR2AuditStateError(Object.assign(new Error("API"), { code })),
    ).toBe(true);
  },
);

test.each([400, 401, 403, 404, 409, 422, 600])(
  "does not retry Kubernetes status %s",
  (code) => {
    expect(
      isTransientR2AuditStateError(Object.assign(new Error("API"), { code })),
    ).toBe(false);
  },
);

test("recovers a transient read without refreshing the saved observation", async () => {
  let reads = 0;
  const state = {
    version: 1,
    bucket: "test-retry",
    observedAt: 1000,
    orphanPrefixCount: 79,
    orphanBytes: 12_345,
    incompleteChainCount: 5,
  };
  const store: AuditStateStore = {
    read: () => {
      reads += 1;
      return reads === 1
        ? Promise.reject(
            new Error("wrapped", {
              cause: Object.assign(new Error("unavailable"), { code: 503 }),
            }),
          )
        : Promise.resolve({ data: { "audit.json": JSON.stringify(state) } });
    },
    replace: () => Promise.reject(new Error("unexpected write")),
  };
  expect(
    await retryUntilReady({
      operation: () => restoreVeleroR2AuditMetrics(store),
      shouldRetry: isTransientR2AuditStateError,
      isClosed: () => false,
      sleep: () => Promise.resolve(),
    }),
  ).toBe("succeeded");
  expect(reads).toBe(2);
  expect(await register.metrics()).toContain(
    'bucket="test-retry",component="temporal-worker"} 1000',
  );
  expect(isTransientR2AuditStateError(new SyntaxError("invalid JSON"))).toBe(
    false,
  );
  expect(
    isTransientR2AuditStateError(
      Object.assign(new Error("socket"), { code: "ECONNRESET" }),
    ),
  ).toBe(true);
});

test("restores observations across restart without refreshing time or permitting older writes", async () => {
  let value: V1ConfigMap = { metadata: { resourceVersion: "1" }, data: {} };
  const store: AuditStateStore = {
    read: () => Promise.resolve(value),
    replace: (next) => {
      value = next;
      return Promise.resolve();
    },
  };
  const state = {
    version: 1 as const,
    bucket: "test-restart",
    observedAt: 1000,
    orphanPrefixCount: 79,
    orphanBytes: 12_345,
    incompleteChainCount: 5,
  };
  recordVeleroR2AuditState(await publishVeleroR2AuditState(state, store));
  await restoreVeleroR2AuditMetrics(store);
  expect(
    await publishVeleroR2AuditState(
      { ...state, observedAt: 900, orphanPrefixCount: 0 },
      store,
    ),
  ).toEqual(state);
  const metrics = await register.metrics();
  expect(metrics).toContain(
    'bucket="test-restart",component="temporal-worker"} 79',
  );
  expect(metrics).toContain(
    'bucket="test-restart",component="temporal-worker"} 1000',
  );
  value.data = { "audit.json": "{}" };
  await expect(restoreVeleroR2AuditMetrics(store)).rejects.toThrow();
});

test("publication failure cannot become a successful zero observation", async () => {
  const store: AuditStateStore = {
    read: () => Promise.resolve({ metadata: { resourceVersion: "1" } }),
    replace: () => Promise.reject(new Error("access denied")),
  };
  await expect(
    publishVeleroR2AuditState(
      {
        version: 1,
        bucket: "failure",
        observedAt: 1000,
        orphanPrefixCount: 0,
        orphanBytes: 0,
        incompleteChainCount: 0,
      },
      store,
    ),
  ).rejects.toThrow("access denied");
});

test("a concurrent newer publication wins a resourceVersion conflict", async () => {
  const state = {
    version: 1 as const,
    bucket: "concurrent",
    observedAt: 1000,
    orphanPrefixCount: 9,
    orphanBytes: 12,
    incompleteChainCount: 0,
  };
  let value: V1ConfigMap = { metadata: { resourceVersion: "1" } };
  let writes = 0;
  const newer = { ...state, observedAt: 1100, orphanPrefixCount: 4 };
  const store: AuditStateStore = {
    read: () => Promise.resolve(value),
    replace: () => {
      writes += 1;
      value = {
        metadata: { resourceVersion: "2" },
        data: { "audit.json": JSON.stringify(newer) },
      };
      return Promise.reject(
        Object.assign(new Error("conflict"), { code: 409 }),
      );
    },
  };
  expect(await publishVeleroR2AuditState(state, store)).toEqual(newer);
  expect(writes).toBe(1);
});
