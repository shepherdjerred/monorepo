import { z } from "zod";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { workerApplicationResources } from "#lib/delivery/workers/worker-hosts.ts";
import type { DeliveryJobReceipt } from "#shared/delivery-job.ts";
import {
  DispatchBarrierSchema,
  type BarrierEffects,
} from "./control-plane-barrier.ts";

export const DISPATCH_RESOURCE_QUERY = new URLSearchParams({
  resourceName: "temporal-delivery-worker",
  namespace: "temporal",
  kind: "Deployment",
  group: "apps",
  version: "v1",
}).toString();

/** Argo's pinned generated API binds POST body to the scalar patch string, not Application PATCH. */
export async function patchDeliveryDispatchResource(
  patch: unknown[],
  transport: typeof fetch = fetch,
) {
  const base = z.url().parse(Bun.env["ARGOCD_SERVER_URL"]);
  const token = z.string().min(1).parse(Bun.env["ARGOCD_TOKEN"]);
  const query = new URLSearchParams(DISPATCH_RESOURCE_QUERY);
  query.set("patchType", "application/json-patch+json");
  const response = await transport(
    new URL(
      `api/v1/applications/delivery-control-plane/resource?${query.toString()}`,
      `${base.replace(/\/$/u, "")}/`,
    ),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(JSON.stringify(patch)),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Owned dispatch replica patch returned HTTP ${String(response.status)}`,
    );
}

export function deliveryDispatchBarrierEffects(
  deploymentId: string,
  native: DeliveryJobReceipt,
  fence: () => Promise<void>,
): BarrierEffects {
  return {
    read: async () => {
      const result = z
        .object({ manifest: z.string() })
        .parse(
          await argoApplicationRequest(
            `delivery-control-plane/resource?${DISPATCH_RESOURCE_QUERY}`,
          ),
        );
      return JSON.parse(result.manifest) as unknown;
    },
    pods: async () =>
      await workerApplicationResources(
        "delivery-control-plane",
        "Pod",
        argoApplicationRequest,
      ),
    replicaSet: async (uid) => {
      const replicas = await workerApplicationResources(
        "delivery-control-plane",
        "ReplicaSet",
        argoApplicationRequest,
      );
      return replicas.find(
        (raw) =>
          z.object({ metadata: z.object({ uid: z.string() }) }).parse(raw)
            .metadata.uid === uid,
      );
    },
    patch: patchDeliveryDispatchResource,
    checkpoint: async (journal) => {
      await deliveryRequest(
        `deployments/${encodeURIComponent(deploymentId)}/stages`,
        z.unknown(),
        {
          key: "control-plane",
          status: "running",
          operationId: native.name,
          message: JSON.stringify(native),
          evidence: [
            {
              kind: "preflight",
              operationId: native.uid,
              summary: JSON.stringify(journal),
            },
          ],
        },
      );
    },
    fence,
    wait: async () => {
      await Bun.sleep(5000);
    },
  };
}

export function recordedDispatchBarrier(detail: DeploymentDetail) {
  const stage = detail.stages.find((value) => value.key === "control-plane");
  if (stage?.message.startsWith("{") !== true) return;
  const native = z.object({ uid: z.string() }).parse(JSON.parse(stage.message));
  const records = detail.evidence
    .filter(
      (evidence) =>
        evidence.kind === "preflight" && evidence.operationId === native.uid,
    )
    .flatMap((evidence) => {
      if (!evidence.summary.startsWith("{")) return [];
      const parsed = DispatchBarrierSchema.safeParse(
        JSON.parse(evidence.summary),
      );
      return parsed.success ? [parsed.data] : [];
    });
  if (new Set(records.map((value) => canonicalJson(value))).size > 1)
    throw new Error(
      "Control-plane dispatch journal changed under the same native Job UID",
    );
  return records[0];
}
