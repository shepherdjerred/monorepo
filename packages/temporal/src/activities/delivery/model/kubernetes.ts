import { Context } from "@temporalio/activity";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  createArgoApplication,
  getArgoApplication,
  setArgoSelfHeal,
  updateArgoApplication,
} from "#lib/delivery/argo-client.ts";
import {
  renderApplication,
  type RenderedApplication,
} from "#lib/delivery/model/application.ts";
import { applicationProgress } from "#lib/delivery/model/application-proof.ts";
import type { KubernetesApplicationRecipe } from "#lib/delivery/model/recipe.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { runGuardedArgoCommand } from "#activities/delivery/argocd.ts";
import { recordStage, requireOwned, stageOf } from "./stages.ts";
import { workerRolloutPreflight } from "./worker-rollout.ts";
import { minecraftSyncFence } from "./minecraft-upgrade.ts";

const READBACK_ATTEMPTS = 120;
const READBACK_INTERVAL_MS = 5000;

function signal() {
  return Context.current().cancellationSignal;
}

/** HTTPS chart bytes must match the artifact digest; other stores serve the recorded version. */
async function verifySourceBytes(
  rendered: RenderedApplication,
  operationId: string,
): Promise<EvidenceInput> {
  const artifact = rendered.sourceArtifact;
  if (!artifact.uri.startsWith("https://"))
    return {
      kind: "preflight",
      operationId,
      summary: `Source ${artifact.id} ${artifact.version} is bound by its recorded digest ${artifact.digest}; its store serves it by version`,
    };
  const response = await fetch(artifact.uri, {
    signal: AbortSignal.any([signal(), AbortSignal.timeout(30_000)]),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `Source inspection returned HTTP ${response.status.toString()}`,
    );
  const digest = `sha256:${createHash("sha256")
    .update(new Uint8Array(await response.arrayBuffer()))
    .digest("hex")}`;
  if (digest !== artifact.digest)
    throw new Error(
      "Published source bytes differ from the immutable artifact digest",
    );
  return {
    kind: "preflight",
    operationId,
    summary: `Source ${artifact.id} bytes match ${artifact.digest}`,
  };
}

const OperationPhaseSchema = z
  .object({
    metadata: z.object({ resourceVersion: z.string().min(1) }),
    status: z
      .object({
        operationState: z.object({ phase: z.string() }).optional(),
      })
      .optional(),
  })
  .loose();

/** Create when absent; otherwise replace the whole body under CAS and ownership (T2). */
async function writeBody(rendered: RenderedApplication) {
  const current = await getArgoApplication(rendered.name, {
    signal: signal(),
  });
  if (current === null) {
    await createArgoApplication(rendered.body, { signal: signal() });
    return "created";
  }
  const observed = OperationPhaseSchema.parse(current);
  if (
    ["Running", "Terminating"].includes(
      observed.status?.operationState?.phase ?? "",
    )
  )
    throw new Error(
      `Application ${rendered.name} has an unsettled operation; retain ownership`,
    );
  await updateArgoApplication(
    rendered.name,
    {
      ...rendered.body,
      metadata: {
        ...rendered.body.metadata,
        resourceVersion: observed.metadata.resourceVersion,
      },
    },
    { environmentId: rendered.environmentId },
    { signal: signal() },
  );
  return "updated";
}

/**
 * The apply-safety step: verify the source, write the full body with
 * automation off, then prove the managed resources at the exact revision
 * apply safely, all recorded as one stage before the sync step.
 */
export async function applySafety(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  key: string,
) {
  const rendered = renderApplication(current, recipe);
  const operationId = deliveryOperationId(current.deployment.id);
  const source = await verifySourceBytes(rendered, operationId);
  // A worker pool's images and routes are proved before its hosts change.
  await workerRolloutPreflight(current);
  await recordStage(current, key, "running", { operationId });
  const written = await writeBody(rendered);
  await runGuardedArgoCommand(
    ["assert-apply-safe", rendered.name, "--revision", rendered.revision],
    { operationId, application: rendered.name },
  );
  await recordStage(current, key, "succeeded", {
    operationId,
    evidence: [
      source,
      {
        kind: "preflight",
        operationId,
        summary: `Application ${rendered.name} ${written} from the recipe's full body (sha256 ${createHash(
          "sha256",
        )
          .update(canonicalJson(rendered.body))
          .digest(
            "hex",
          )}); managed resources at ${rendered.revision} are apply-safe`,
      },
    ],
  });
}

async function waitForReadback(
  rendered: RenderedApplication,
  requestId: string,
  deploymentId: string,
) {
  let incarnation: string | undefined;
  for (let attempt = 0; attempt < READBACK_ATTEMPTS; attempt++) {
    await requireOwned(deploymentId);
    const raw = await getArgoApplication(rendered.name, { signal: signal() });
    if (raw === null)
      throw new Error(`Application ${rendered.name} disappeared while syncing`);
    const progress = applicationProgress(raw, rendered, requestId);
    if (incarnation !== undefined && incarnation !== progress.uid)
      throw new Error("Application incarnation changed while waiting");
    incarnation = progress.uid;
    if (progress.settled) return progress;
    Context.current().heartbeat({ requestId, attempt });
    await Bun.sleep(READBACK_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${rendered.name} to settle Synced and Healthy`,
  );
}

/**
 * The sync step: the guarded, request-identified sync of the rendered source
 * and its readback proof. A resumed step whose request already reached the
 * Application only reads back; it never syncs twice.
 */
export async function sync(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  key: string,
) {
  const rendered = renderApplication(current, recipe);
  const requestId = deliveryOperationId(current.deployment.id);
  const raw = await getArgoApplication(rendered.name, { signal: signal() });
  if (raw === null)
    throw new Error(
      `Application ${rendered.name} is missing; the apply-safety step writes it first`,
    );
  const before = applicationProgress(raw, rendered, requestId);
  if (stageOf(current, key) === undefined)
    await recordStage(current, key, "running", { operationId: requestId });
  // A preserved world switches images only with fresh preservation proof.
  if (!before.requested) minecraftSyncFence(current, recipe);
  if (!before.requested)
    await runGuardedArgoCommand(
      [
        "sync-managed",
        rendered.name,
        "--revision",
        rendered.revision,
        "--request-id",
        requestId,
        "--timeout",
        "1200",
      ],
      { operationId: requestId, application: rendered.name },
    );
  const proof = await waitForReadback(
    rendered,
    requestId,
    current.deployment.id,
  );
  await recordStage(current, key, "succeeded", {
    operationId: requestId,
    evidence: [
      {
        kind: "reconciliation",
        operationId: proof.operationId,
        summary: `Owned operation ${proof.operationId} synced ${rendered.name} to ${proof.revision}; Synced and Healthy with the exact rendered source`,
      },
    ],
  });
}

/**
 * After acceptance, ArgoCD self-heals the accepted exact source with pruning
 * off (T4), where the adapter decided it may: never for self-hosted or
 * data-layer targets.
 */
export async function enableSelfHeal(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
) {
  if (!current.selfHeals) return null;
  const rendered = renderApplication(current, recipe);
  return await setArgoSelfHeal(
    rendered.name,
    { environmentId: rendered.environmentId, expectedSource: rendered.source },
    { signal: signal() },
  );
}
