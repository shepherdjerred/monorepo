import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  PlatformReleaseSnapshotSchema,
  TofuPlanReceiptSchema,
  RecordPlatformRecoveryPlanSchema,
} from "@shepherdjerred/delivery/contract";
import type { DeliveryTofuContext } from "homelab/scripts/tofu/delivery-stack.ts";
import { decryptRecoveryPlan } from "#lib/delivery/platform/plan-crypto.ts";
import { runTofuRecoveryInWorkspace } from "./tofu.ts";

afterEach(() => vi.unstubAllEnvs());
test("partial OpenTofu target requires an encrypted intent-bound recovery plan; unchanged state alone cannot unlock", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "recovery-tofu-test-"));
  vi.stubEnv(
    "DELIVERY_PLAN_ENCRYPTION_PASSPHRASE",
    "fixture-only-recovery-encryption-passphrase",
  );
  try {
    const native = {
      namespace: "delivery-platform-jobs" as const,
      name: `delivery-${"a".repeat(40)}`,
      uid: crypto.randomUUID(),
      specFingerprint: "b".repeat(64),
      requestId: "recovery/test",
    };
    const time = new Date();
    const plan = TofuPlanReceiptSchema.parse({
      schema: "delivery-tofu-plan/v1",
      deploymentId: "original/plan",
      sourceBuildId: "build/original",
      sourceRevision: "c".repeat(40),
      stack: "cloudflare",
      createdAt: time.toISOString(),
      expiresAt: new Date(time.getTime() + 60_000).toISOString(),
      planDigest: `sha256:${"d".repeat(64)}`,
      state: { lineage: "exact-original", serial: 3 },
      nativeJob: { ...native, requestId: "original/plan" },
      changes: { create: 1, update: 0, delete: 0, replace: 0 },
    });
    const parsed = PlatformReleaseSnapshotSchema.parse({
      kind: "tofu-apply",
      source: {
        id: plan.sourceBuildId,
        sourceRevision: plan.sourceRevision,
        repositoryId: 1,
        pipelineNumber: 900,
        ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/900",
      },
      stack: plan.stack,
      planDeploymentId: plan.deploymentId,
      plan,
      prerequisites: [],
      policyFingerprint: "e".repeat(64),
    });
    if (parsed.kind !== "tofu-apply") throw new Error("Expected apply fixture");
    let changed = true;
    const privateBytes = new TextEncoder().encode(
      "private original-source recovery plan",
    );
    const tofu: DeliveryTofuContext = {
      stack: plan.stack,
      workspace,
      state: async () => ({ lineage: "exact-original", serial: 4 }),
      command: vi.fn(async (args) => {
        if (args[0] === "plan") {
          await Bun.write(
            path.join(workspace, "recovery.tfplan"),
            privateBytes,
          );
          return { stdout: "", exitCode: changed ? 2 : 0 };
        }
        if (args[0] === "show")
          return {
            stdout: JSON.stringify({
              resource_changes: changed
                ? [{ change: { actions: ["create"] } }]
                : [],
            }),
            exitCode: 0,
          };
        throw new Error(
          "Inspection must never apply or use arbitrary commands",
        );
      }),
    };
    const fence = vi.fn(async () => {
      throw new Error("Read-only planning cannot authorize apply");
    });
    const input = {
      snapshot: parsed,
      intentId: native.requestId,
      native,
      fence,
    };
    await expect(
      runTofuRecoveryInWorkspace(input, "inspect", tofu),
    ).rejects.toThrow("partial or drifted");
    const stored = RecordPlatformRecoveryPlanSchema.parse(
      await runTofuRecoveryInWorkspace(input, "plan", tofu),
    );
    expect(stored.receipt.recoveryIntentId).toBe(native.requestId);
    expect(stored.receipt.sourceBuildId).toBe(plan.sourceBuildId);
    expect(stored.receipt.nativeJob.uid).toBe(native.uid);
    expect(stored.receipt).not.toHaveProperty("deploymentId");
    expect(JSON.stringify(stored)).not.toContain(
      "private original-source recovery plan",
    );
    expect(
      decryptRecoveryPlan(
        stored,
        Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]!,
      ),
    ).toEqual(privateBytes);
    expect(() =>
      decryptRecoveryPlan(
        {
          ...stored,
          receipt: { ...stored.receipt, recoveryIntentId: "other/recovery" },
        },
        Bun.env["DELIVERY_PLAN_ENCRYPTION_PASSPHRASE"]!,
      ),
    ).toThrow();
    expect(fence).not.toHaveBeenCalled();
    changed = false;
    expect(
      await runTofuRecoveryInWorkspace(input, "inspect", tofu),
    ).toMatchObject({ state: "desired" });
    await expect(
      runTofuRecoveryInWorkspace(input, "inspect", {
        ...tofu,
        state: async () => ({ lineage: "different", serial: 4 }),
      }),
    ).rejects.toThrow("lineage");
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => {
        expect(new URL(request.url).pathname).toBe(
          `/api/v1/platform-recovery/${encodeURIComponent(native.requestId)}/plan`,
        );
        return Response.json(stored);
      },
    });
    vi.stubEnv("DELIVERY_API_URL", server.url.origin);
    vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "disposable-recovery-executor");
    const admitted = vi.fn(() => Promise.resolve());
    let applied = false;
    try {
      const effectful = {
        ...tofu,
        state: async () => ({
          lineage: "exact-original",
          serial: applied ? 5 : 4,
        }),
        command: vi.fn(async (args: readonly string[]) => {
          expect(args).toEqual([
            "apply",
            "-input=false",
            "-lock-timeout=5m",
            path.join(workspace, "recovery.tfplan"),
          ]);
          expect(admitted).toHaveBeenCalledOnce();
          expect(
            new Uint8Array(
              await Bun.file(
                path.join(workspace, "recovery.tfplan"),
              ).arrayBuffer(),
            ),
          ).toEqual(privateBytes);
          applied = true;
          return { stdout: "", exitCode: 0 };
        }),
      };
      expect(
        await runTofuRecoveryInWorkspace(
          { ...input, fence: admitted },
          "apply",
          effectful,
        ),
      ).toMatchObject({
        outcome: "applied-recovery-plan",
        planDigest: stored.receipt.planDigest,
        state: { lineage: "exact-original", serial: 5 },
      });
      expect(effectful.command).toHaveBeenCalledOnce();
    } finally {
      await server.stop(true);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
