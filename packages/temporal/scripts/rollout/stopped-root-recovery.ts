import { z } from "zod";
import type { Connection } from "@temporalio/client";
import { V1Job, V1Pod } from "@kubernetes/client-node";
import { ObjectSerializer } from "@kubernetes/client-node/dist/gen/models/ObjectSerializer.js";
import {
  PlatformRecoveryContextSchema,
  CompletePlatformRecoverySchema,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { inspectStoppedRootRecovery } from "#lib/delivery/platform/recovery/root-stopped.ts";
import {
  closedPlatformWorkflow,
  provePlatformNativeJobs,
} from "#lib/delivery/platform/recovery/native-proof.ts";
import { renderWorkerChart } from "#lib/delivery/workers/worker-control-plane.ts";
import { controlPlaneCommand } from "#scripts/jobs/control-plane.ts";

/** Host-only inspection avoids executing new recovery code inside the original frozen Job source. */
export async function recoverStoppedRoot(id: string, connection: Connection) {
  const base = `platform-recovery/${encodeURIComponent(id)}`;
  const load = async () =>
    await deliveryRequest(base, PlatformRecoveryContextSchema);
  const context = await load();
  if (
    context.intent.status !== "pending" ||
    context.expectedSettlements.stopped === undefined
  )
    throw new Error(
      "Stopped root recovery requires its pending frozen root-attempt intent",
    );
  Bun.env["ARGOCD_TOKEN"] = z
    .string()
    .min(1)
    .parse(Bun.env["ARGOCD_AUTH_TOKEN"]);
  Bun.env["ARGOCD_SERVER_URL"] = "https://argocd.sjer.red";
  Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
  const nativeReader = stoppedRootNativeReader();
  await closedPlatformWorkflow(connection, context.deployment.deployment.id);
  await provePlatformNativeJobs(context, nativeReader);
  const observed = await inspectStoppedRootRecovery(context, {
    read: argoApplicationRequest,
    render: async (chart) =>
      await renderWorkerChart(
        {
          chart,
          selection: {
            application: "apps",
            environmentId: context.deployment.environment.id,
            repository: "https://chartmuseum.tailnet-1a49.ts.net",
            chart: "apps",
            revision: chart.version,
            namespace: "argocd",
            parameters: {},
          },
        },
        controlPlaneCommand,
      ),
  });
  const current = await load();
  if (canonicalJson(current) !== canonicalJson(context))
    throw new Error(
      "Root attempt recovery ownership changed during inspection",
    );
  const { state, ...observation } = observed;
  const proof = CompletePlatformRecoverySchema.parse({
    ...observation,
    expectedEnvironmentGeneration: context.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: context.intent.snapshotFingerprint,
    sourceWorkflow: await closedPlatformWorkflow(
      connection,
      context.deployment.deployment.id,
    ),
    nativeJobs: await provePlatformNativeJobs(current, nativeReader),
    settlement: {
      state,
      fingerprint: z.string().parse(current.expectedSettlements.stopped),
    },
  });
  await deliveryRequest(`${base}/complete`, z.unknown(), proof);
  return {
    status: "settled",
    originalDeploymentResult: "unchanged",
    acceptedRoot: false,
  };
}

/** kubectl retains supported mTLS; owning native proof still validates every Job/Pod. */
async function stoppedRootQuery(args: string[]) {
  const child = Bun.spawn(
    [
      "kubectl",
      "--context",
      "admin@torvalds",
      "-n",
      "delivery-platform-jobs",
      "get",
      ...args,
      "-o",
      "json",
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, output] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error("Trusted native root recovery read failed");
  if (output.trim() === "")
    throw Object.assign(new Error("Native Job not found"), { code: 404 });
  return z.record(z.string(), z.unknown()).parse(JSON.parse(output));
}
function stoppedRootNativeReader() {
  return {
    job: async (name: string) => {
      const value: unknown = ObjectSerializer.deserialize(
        await stoppedRootQuery(["job", name, "--ignore-not-found=true"]),
        "V1Job",
        "",
      );
      if (!(value instanceof V1Job))
        throw new TypeError("Native root Job response has the wrong model");
      return value;
    },
    pods: async (name: string) => {
      const list = await stoppedRootQuery([
        "pods",
        "--selector",
        `job-name=${name}`,
      ]);
      return z
        .array(z.unknown())
        .parse(list["items"])
        .map((raw) => {
          const value: unknown = ObjectSerializer.deserialize(raw, "V1Pod", "");
          if (!(value instanceof V1Pod))
            throw new TypeError(
              "Native root executor Pod response has the wrong model",
            );
          return value;
        });
    },
  };
}
