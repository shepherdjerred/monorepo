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
import { requireOriginalDiscordTarget } from "./tofu-original.ts";
import { encryptDeliveryPlan } from "#lib/delivery/platform/plan-crypto.ts";
import { createHash } from "node:crypto";
import { STACK_MANIFEST } from "homelab/scripts/tofu/tofu-stack-manifest.ts";
const secrets = STACK_MANIFEST.discord.secretObject;
if (secrets === undefined)
  throw new Error("Discord credential fixture requires its real manifest");
const credentials = Object.entries(secrets.entries);

function discordBefore() {
  const applications = Object.fromEntries(
    credentials.map(([name]) => {
      const alias = name.replaceAll("-", "_");
      return [
        alias,
        {
          id: alias,
          description: "original",
          custom_install_url: null,
          interactions_endpoint_url: "",
          role_connections_verification_url: "",
          tags: new Array<string>(),
          bot_public: false,
          bot_require_code_grant: false,
        },
      ];
    }),
  );
  return {
    applications,
    resource_changes: credentials.map(([name]) => {
      const alias = name.replaceAll("-", "_");
      return {
        address: `discord_application_settings.${alias}`,
        mode: "managed",
        change: {
          actions: alias === "birmel" ? ["update"] : ["no-op"],
          before: { id: alias, description: "original" },
          after: { id: alias, description: "desired" },
          after_unknown: {},
        },
      };
    }),
    prior_state: {
      values: {
        root_module: {
          resources: Object.entries(applications).map(([alias, values]) => ({
            address: `data.discord_current_application.${alias}`,
            mode: "data",
            type: "discord_current_application",
            values,
          })),
        },
      },
    },
    planned_values: { root_module: { resources: [] } },
  };
}

test("original Discord target compares six managed before rows and six computed prior data rows with fresh native reads", () => {
  const original = discordBefore();
  expect(
    requireOriginalDiscordTarget(
      original,
      structuredClone(original),
      original.applications,
    ),
  ).toMatch(/^[a-f0-9]{64}$/u);
});
test.each([
  "managed drift",
  "private changed",
  "missing baseline",
  "unknown baseline",
  "duplicate inventory",
  "wrong application",
  "nonempty tags",
])("original target rejects %s", (failure) => {
  const original = discordBefore();
  const current = structuredClone(original);
  const baseline = structuredClone(original);
  const managed = current.resource_changes[0];
  const data = baseline.prior_state.values.root_module.resources[0];
  if (!managed || !data) throw new Error("Complete fixture required");
  if (failure === "managed drift")
    managed.change.before.description = "changed";
  if (failure === "private changed")
    current.applications["birmel"]!.bot_public = true;
  if (failure === "missing baseline")
    Reflect.deleteProperty(data.values, "bot_public");
  if (failure === "unknown baseline")
    Reflect.set(data.values, "bot_public", { unknown: true });
  if (failure === "duplicate inventory")
    current.resource_changes.push(structuredClone(managed));
  if (failure === "wrong application")
    current.applications["birmel"]!.id = "different-app";
  if (failure === "nonempty tags")
    current.applications["birmel"]!.tags.push("unexpected");
  expect(() =>
    requireOriginalDiscordTarget(baseline, current, current.applications),
  ).toThrow();
});

test("first Discord apply authenticates original saved bytes and settles only original targets despite stable serial advance", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "original-discord-"));
  const passphrase = "fixture-only-authenticated-plan-passphrase";
  vi.stubEnv("DELIVERY_PLAN_ENCRYPTION_PASSPHRASE", passphrase);
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "fixture-executor");
  const bytes = new TextEncoder().encode("authenticated original saved binary");
  const receipt = TofuPlanReceiptSchema.parse({
    schema: "delivery-tofu-plan/v1",
    deploymentId: "original/discord/plan",
    sourceBuildId: "original/build",
    sourceRevision: "c".repeat(40),
    stack: "discord",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    planDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    state: { lineage: "original-discord", serial: 1 },
    nativeJob: {
      namespace: "delivery-platform-jobs",
      name: `delivery-${"a".repeat(40)}`,
      uid: crypto.randomUUID(),
      specFingerprint: "b".repeat(64),
      requestId: "original/discord/plan",
    },
    changes: { create: 0, update: 1, delete: 0, replace: 0 },
  });
  const snapshot = PlatformReleaseSnapshotSchema.parse({
    kind: "tofu-apply",
    source: {
      id: receipt.sourceBuildId,
      sourceRevision: receipt.sourceRevision,
      repositoryId: 1,
      pipelineNumber: 900,
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/900",
    },
    prerequisites: [],
    policyFingerprint: "d".repeat(64),
    stack: "discord",
    planDeploymentId: receipt.deploymentId,
    plan: receipt,
  });
  if (snapshot.kind !== "tofu-apply") throw new Error("Apply fixture required");
  const stored = encryptDeliveryPlan(receipt, bytes, passphrase);
  let tamper = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      expect(new URL(request.url).pathname).toBe(
        `/api/v1/platform/plans/${encodeURIComponent(receipt.deploymentId)}`,
      );
      return Response.json(
        tamper
          ? {
              ...stored,
              receipt: { ...receipt, sourceRevision: "f".repeat(40) },
            }
          : stored,
      );
    },
  });
  vi.stubEnv("DELIVERY_API_URL", server.url.origin);
  const nativeFetch = globalThis.fetch;
  let invalidTags = false;
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url !== "https://discord.com/api/v10/applications/@me")
        return nativeFetch(input, init);
      const credential = new Headers(init?.headers)
        .get("Authorization")
        ?.slice("Bot ".length);
      const alias = credentials
        .find(([, key]) => credential === key)?.[0]
        .replaceAll("-", "_");
      if (!alias)
        throw new Error("Only existing owning application credentials allowed");
      return Response.json({
        ...discordBefore().applications[alias],
        ...(invalidTags ? { tags: null } : {}),
      });
    });
  for (const [, credential] of credentials) vi.stubEnv(credential, credential);
  const state = { ...receipt.state, serial: 2 };
  const tofu: DeliveryTofuContext = {
    stack: "discord",
    workspace,
    state: async () => state,
    command: async (args) => {
      if (args[0] === "plan") return { stdout: "", exitCode: 2 };
      if (args[0] !== "show") throw new Error("No provider mutations allowed");
      if (args[2]?.endsWith("original.tfplan"))
        expect(new Uint8Array(await Bun.file(args[2]).arrayBuffer())).toEqual(
          bytes,
        );
      return { stdout: JSON.stringify(discordBefore()), exitCode: 0 };
    },
  };
  const input = {
    snapshot,
    intentId: "recovery/discord",
    native: receipt.nativeJob,
    fence: async () => {
      throw new Error("No apply admission allowed");
    },
    original: true,
  };
  try {
    const result = await runTofuRecoveryInWorkspace(input, "inspect", tofu);
    expect(result).toMatchObject({ state: "original" });
    if (!("proofSummary" in result))
      throw new Error("Expected inspection result");
    expect(result.proofSummary).toContain(
      "original serial 1, stable current serial 2",
    );
    invalidTags = true;
    await expect(
      runTofuRecoveryInWorkspace(input, "inspect", tofu),
    ).rejects.toThrow("tags are invalid");
    invalidTags = false;
    await expect(
      runTofuRecoveryInWorkspace(
        { ...input, original: false },
        "inspect",
        tofu,
      ),
    ).rejects.toThrow("partial or drifted");
    for (const invalid of [
      { ...state, lineage: "wrong" },
      { ...state, serial: 0 },
    ])
      await expect(
        runTofuRecoveryInWorkspace(input, "inspect", {
          ...tofu,
          state: async () => invalid,
        }),
      ).rejects.toThrow("lineage");
    let reads = 0;
    await expect(
      runTofuRecoveryInWorkspace(input, "inspect", {
        ...tofu,
        state: async () => ({ ...state, serial: ++reads >= 3 ? 3 : 2 }),
      }),
    ).rejects.toThrow("changed during original-baseline");
    tamper = true;
    await expect(
      runTofuRecoveryInWorkspace(input, "inspect", tofu),
    ).rejects.toThrow("receipt differs");
  } finally {
    fetchSpy.mockRestore();
    await server.stop(true);
    await rm(workspace, { recursive: true, force: true });
  }
});

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
