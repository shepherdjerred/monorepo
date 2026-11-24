import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { V1Job } from "@kubernetes/client-node";
import { PlatformRecoveryContextSchema } from "@shepherdjerred/delivery/contract";
import type { DeliveryTofuContext } from "homelab/scripts/tofu/delivery-stack.ts";
import { detail, timestamp } from "#lib/delivery/model/testing.ts";
import {
  savedTofuPlan,
  tofuArchive,
  tofuPlanReceipt,
  tofuRecipe,
} from "#lib/delivery/model/tofu-testing.ts";
import { requireModelRecipe } from "#lib/delivery/model/recipe.ts";
import {
  modelApplyInput,
  modelPlanInput,
  modelTofuJobRequest,
} from "#lib/delivery/model/tofu.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import type { TofuRecoveryTarget } from "./tofu.ts";

const api = vi.hoisted(() => {
  const paths: string[] = [];
  const bodies: { route: string; body: unknown }[] = [];
  return { paths, bodies, responses: new Map<string, unknown>() };
});
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: vi.fn(
    (
      route: string,
      schema: { parse: (raw: unknown) => unknown },
      body?: unknown,
    ) => {
      api.paths.push(route);
      if (body !== undefined) api.bodies.push({ route, body });
      return Promise.resolve(schema.parse(api.responses.get(route)));
    },
  ),
}));
const { isUnappliedModelTofuDeployment, recoveryExecutionJob } =
  await import("./request.ts");
const { provePlatformNativeJobs } = await import("./native-proof.ts");
const { runTofuRecoveryInWorkspace } = await import("./tofu.ts");
const { executePlatformRecoveryAction } = await import("./execute.ts");

afterEach(() => {
  api.paths.splice(0);
  api.bodies.splice(0);
  api.responses.clear();
});

const archive = tofuArchive;
const tofu = tofuRecipe;
const plan = tofuPlanReceipt;
const saved = savedTofuPlan;

/** A failed model tofu deployment whose step stages recorded these native Jobs. */
function quarantined(
  stages: { request: DeliveryJobRequest; status: "running" | "succeeded" }[],
) {
  const base = detail(
    tofu,
    archive,
    stages.map(({ request, status }) => ({ key: request.stageKey, status })),
  );
  base.stages = base.stages.map((stage, index) => {
    const recorded = stages[index];
    if (recorded === undefined) throw new Error("Expected a recorded stage");
    const manifest = deliveryJobManifest(recorded.request);
    return {
      ...stage,
      operationId: manifest.metadata?.name ?? "",
      message: JSON.stringify(receiptOf(recorded.request)),
    };
  });
  return PlatformRecoveryContextSchema.parse({
    intent: {
      id: "recovery/1",
      deploymentId: "deployment/1",
      requestedBy: "operator",
      reason: "Inspect the stack after its native Job result was lost",
      expectedEnvironmentGeneration: 1,
      snapshotFingerprint: "a".repeat(64),
      status: "pending",
      workflowId: "delivery-platform-recovery/recovery/1",
      submittedAt: null,
      message: null,
      createdAt: timestamp,
      finishedAt: null,
    },
    deployment: base,
    priorDeployment: null,
    recoveryHistory: [],
    expectedSettlements: { desired: "b".repeat(64) },
  });
}

function receiptOf(request: DeliveryJobRequest) {
  const manifest = deliveryJobManifest(request);
  return {
    namespace: "delivery-platform-jobs" as const,
    name: manifest.metadata?.name ?? "",
    uid: `uid-${request.stageKey}`,
    specFingerprint:
      manifest.metadata?.annotations?.[
        "delivery.shepherdjerred.com/fingerprint"
      ] ?? "",
    requestId: request.deploymentId,
  };
}

/** A reader that finds each expected Job complete with no live Pods. */
function reader(requests: DeliveryJobRequest[]) {
  const jobs = new Map(
    requests.map((request) => {
      const job: V1Job = deliveryJobManifest(request);
      job.metadata = structuredClone(job.metadata) ?? {};
      job.metadata.uid = `uid-${request.stageKey}`;
      job.status = {
        active: 0,
        conditions: [{ type: "Complete", status: "True" }],
      };
      return [job.metadata.name ?? "", job] as const;
    }),
  );
  return {
    read: async (name: string) => {
      const job = jobs.get(name);
      if (job === undefined)
        throw Object.assign(new Error("absent"), { code: 404 });
      return job;
    },
    pods: async () => [],
  };
}

const value = detail(tofu, archive);
const recipe = requireModelRecipe(value);
if (recipe.kind !== "tofu") throw new Error("Expected a tofu recipe");
const planRequest = modelTofuJobRequest(value, {
  recipe,
  key: "step-plan",
  kind: "tofu-plan",
  jobInput: modelPlanInput(value, recipe),
});
const applyRequest = modelTofuJobRequest(value, {
  recipe,
  key: "step-apply",
  kind: "tofu-apply",
  jobInput: modelApplyInput(value, recipe, plan),
});

describe("model tofu platform recovery (X8)", () => {
  it("runs the recovery Job with the frozen runner, from the frozen stack archive", () => {
    const context = quarantined([{ request: planRequest, status: "running" }]);
    const request = recoveryExecutionJob(context, {
      intent: context.intent,
      action: "inspect",
      attempt: 1,
    });
    expect(request).toMatchObject({
      recipe: "platform-recovery",
      runnerImage: planRequest.runnerImage,
      sourceRevision: archive.sourceRevision,
      input: {
        target: "tofu",
        stack: "cloudflare",
        archive: { uri: archive.uri, digest: archive.digest },
      },
    });
    // The archive reader credential lets the Job stage and verify the archive.
    const env = deliveryJobManifest(request)
      .spec?.template.spec?.containers.flatMap(
        (container) => container.env ?? [],
      )
      .map((entry) => entry.name);
    expect(env).toContain("DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID");
  });

  it("proves the plan Job, and the apply Job once a plan was saved", async () => {
    const planOnly = quarantined([{ request: planRequest, status: "running" }]);
    const planJobs = reader([planRequest]);
    const proved = await provePlatformNativeJobs(planOnly, {
      job: planJobs.read,
      pods: planJobs.pods,
    });
    expect(proved.map((job) => [job.name, job.status])).toEqual([
      [receiptOf(planRequest).name, "Complete"],
    ]);
    expect(api.paths).toEqual([]);
    api.responses.set("platform/plans/deployment%2F1", saved);
    const applied = quarantined([
      { request: planRequest, status: "succeeded" },
      { request: applyRequest, status: "running" },
    ]);
    const both = reader([planRequest, applyRequest]);
    const provedBoth = await provePlatformNativeJobs(applied, {
      job: both.read,
      pods: both.pods,
    });
    expect(provedBoth.map((job) => job.name)).toEqual([
      receiptOf(planRequest).name,
      receiptOf(applyRequest).name,
    ]);
  });

  it("converges forward to the frozen source, bounded by the saved plan's state", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "model-recovery-"));
    try {
      let changed = false;
      const context: DeliveryTofuContext = {
        stack: "cloudflare",
        workspace,
        state: async () => ({ lineage: "lineage-1", serial: 5 }),
        command: vi.fn(async (args: readonly string[]) => {
          if (args[0] === "plan")
            return { stdout: "", exitCode: changed ? 2 : 0 };
          if (args[0] === "show")
            return {
              stdout: JSON.stringify({
                resource_changes: changed
                  ? [{ change: { actions: ["update"] } }]
                  : [],
              }),
              exitCode: 0,
            };
          throw new Error("Inspection never applies");
        }),
      };
      const target: TofuRecoveryTarget = {
        kind: "tofu-apply",
        stack: "cloudflare",
        sourceBuildId: "build/1",
        sourceRevision: "a".repeat(40),
        plan: null,
      };
      const input = {
        target,
        intentId: "recovery/1",
        native: { ...plan.nativeJob, requestId: "recovery/1" },
        fence: async () => {
          throw new Error("Inspection admits no apply");
        },
      };
      // No plan was saved, so no apply ran; an unchanged stack is desired.
      expect(
        await runTofuRecoveryInWorkspace(input, "inspect", context),
      ).toMatchObject({ state: "desired" });
      changed = true;
      await expect(
        runTofuRecoveryInWorkspace(input, "inspect", context),
      ).rejects.toThrow("partial or drifted");
      // A saved plan bounds the state lineage the recovery may act on.
      await expect(
        runTofuRecoveryInWorkspace(
          {
            ...input,
            target: {
              ...target,
              plan: { ...plan, state: { lineage: "other", serial: 1 } },
            },
          },
          "inspect",
          context,
        ),
      ).rejects.toThrow("lineage");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("pre-effect OpenTofu recovery (AI-423)", () => {
  it("settles an unapplied model tofu failure readonly without re-running the broken archive", async () => {
    const readonlyFingerprint = "c".repeat(64);
    const jobUid = "11111111-1111-4111-8111-111111111111";
    const base = quarantined([{ request: planRequest, status: "running" }]);
    base.deployment.stages[0]!.message = JSON.stringify({
      ...receiptOf(planRequest),
      uid: jobUid,
    });
    const unapplied = {
      ...base,
      expectedSettlements: {
        desired: "b".repeat(64),
        readonly: readonlyFingerprint,
      },
    };
    expect(isUnappliedModelTofuDeployment(unapplied.deployment)).toBe(true);

    api.responses.set("platform-recovery/recovery%2F1", unapplied);
    api.responses.set("platform-recovery/recovery%2F1/complete", {});
    const runJob = vi.fn(() => {
      throw new Error("Broken frozen archive must not be re-executed");
    });
    const planJobManifest: V1Job = deliveryJobManifest(planRequest);
    planJobManifest.metadata = structuredClone(planJobManifest.metadata) ?? {};
    planJobManifest.metadata.uid = jobUid;
    planJobManifest.status = {
      active: 0,
      conditions: [{ type: "Failed", status: "True" }],
    };
    const planJobs = {
      read: async (name: string) => {
        if (name !== planJobManifest.metadata?.name)
          throw Object.assign(new Error("absent"), { code: 404 });
        return planJobManifest;
      },
      pods: async () => [],
    };

    await expect(
      executePlatformRecoveryAction("recovery/1", "plan", {
        runJob,
        closedWorkflow: async () => ({
          workflowId: "delivery/deployment/1",
          status: "FAILED",
        }),
        nativeJobs: async (ctx) =>
          await provePlatformNativeJobs(ctx, {
            job: planJobs.read,
            pods: planJobs.pods,
          }),
      }),
    ).rejects.toThrow(
      "Read-only plan failures cannot authorize recovery mutations",
    );
    expect(runJob).not.toHaveBeenCalled();

    const settled = await executePlatformRecoveryAction(
      "recovery/1",
      "inspect",
      {
        runJob,
        closedWorkflow: async (id) => ({
          workflowId: `delivery/${id}`,
          status: "FAILED",
        }),
        nativeJobs: async (ctx) =>
          await provePlatformNativeJobs(ctx, {
            job: planJobs.read,
            pods: planJobs.pods,
          }),
      },
    );
    expect(settled).toEqual({
      status: "settled",
      originalDeploymentResult: "unchanged",
    });
    expect(runJob).not.toHaveBeenCalled();
    expect(api.bodies).toEqual([
      {
        route: "platform-recovery/recovery%2F1/complete",
        body: expect.objectContaining({
          settlement: { state: "readonly", fingerprint: readonlyFingerprint },
          sourceWorkflow: {
            workflowId: "delivery/deployment/1",
            status: "FAILED",
          },
          nativeJobs: [
            expect.objectContaining({
              name: receiptOf(planRequest).name,
              uid: jobUid,
              status: "Failed",
            }),
          ],
        }),
      },
    ]);

    const afterPlan = quarantined([
      { request: planRequest, status: "succeeded" },
    ]);
    expect(isUnappliedModelTofuDeployment(afterPlan.deployment)).toBe(false);
  });
});
