import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
  effectSignal,
  interruptedByWorkerShutdown,
} from "#lib/delivery/model/effect-signal.ts";
import { DELIVERY_EXECUTOR_REPLACED } from "#shared/delivery-executor.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { verifyOciChart } from "./oci-chart.ts";
import {
  createArgoApplication,
  deleteArgoApplication,
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
import {
  argoRequest,
  GuardedArgoCommandError,
  runGuardedArgoCommand,
} from "#activities/delivery/argocd.ts";
import { recordStage, requireOwned, stageOf } from "./stages.ts";
import {
  workerRetirementFence,
  workerRolloutPreflight,
} from "./worker-rollout.ts";
import { minecraftSyncFence } from "./minecraft-upgrade.ts";
import { forumBaselineFence, forumSyncPrune } from "./forum-bundle.ts";

const READBACK_ATTEMPTS = 120;
const READBACK_INTERVAL_MS = 5000;

function signal() {
  return effectSignal();
}

/**
 * HTTPS chart bytes must match the artifact digest, and an OCI chart's tag
 * must still resolve to it; other stores serve the recorded version. The
 * digest binds the bytes, so the read follows a release host's redirect to
 * its download storage (GitHub release assets always redirect).
 */
async function verifySourceBytes(
  rendered: RenderedApplication,
  operationId: string,
): Promise<EvidenceInput> {
  const artifact = rendered.sourceArtifact;
  if (artifact.uri.startsWith("oci://"))
    return await verifyOciChart(artifact, operationId, signal());
  if (!artifact.uri.startsWith("https://"))
    return {
      kind: "preflight",
      operationId,
      summary: `Source ${artifact.id} ${artifact.version} is bound by its recorded digest ${artifact.digest}; its store serves it by version`,
    };
  const response = await fetch(artifact.uri, {
    signal: AbortSignal.any([signal(), AbortSignal.timeout(30_000)]),
    redirect: "follow",
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
async function writeBody(
  rendered: RenderedApplication,
): Promise<"created" | "updated"> {
  const current = await getArgoApplication(rendered.name, {
    signal: signal(),
    project: rendered.body.spec.project,
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

/** The Application's history: the source of each sync Argo performed. */
const SyncedHistorySchema = z
  .object({
    metadata: z.object({ resourceVersion: z.string().min(1) }),
    status: z
      .object({
        history: z
          .array(
            z.object({
              id: z.number(),
              source: z.record(z.string(), z.unknown()),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .loose();

/**
 * Undoes the apply-safety step's only effect, the body it wrote: a created
 * Application is removed without touching resources (nothing was synced), and
 * an updated one gets back the source Argo last synced. Automation stays off;
 * the next release writes its own body. Resolves what was done.
 */
async function restoreWrittenBody(
  rendered: RenderedApplication,
  written: "created" | "updated",
): Promise<string> {
  if (written === "created") {
    await deleteArgoApplication(
      rendered.name,
      { environmentId: rendered.environmentId, cascade: false },
      { signal: signal() },
    );
    return "removed the Application it had created";
  }
  const current = SyncedHistorySchema.parse(
    await getArgoApplication(rendered.name, {
      signal: signal(),
      project: rendered.body.spec.project,
    }),
  );
  const history = current.status?.history ?? [];
  if (history.length === 0)
    throw new Error(
      `Application ${rendered.name} has no synced source to restore`,
    );
  const latest = history.reduce((left, right) =>
    left.id > right.id ? left : right,
  );
  await updateArgoApplication(
    rendered.name,
    {
      ...rendered.body,
      metadata: {
        ...rendered.body.metadata,
        resourceVersion: current.metadata.resourceVersion,
      },
      spec: { ...rendered.body.spec, source: latest.source },
    },
    { environmentId: rendered.environmentId },
    { signal: signal() },
  );
  return `restored the source Argo last synced (history ${latest.id.toString()})`;
}

const EVIDENCE_SUMMARY_LIMIT = 4000;

/**
 * The read-only assert refused (or could not run) after the body was written.
 * Nothing was synced, so the step undoes the write and records a settled,
 * failed stage with the command's own explanation: the deployment then ends
 * without an unsettled stage and holds nothing (AI-446, AI-439). Only when the
 * undo itself fails does the stage stay running for recovery.
 */
async function refuseApplySafety(
  step: {
    current: DeploymentDetail;
    rendered: RenderedApplication;
    key: string;
    operationId: string;
  },
  written: "created" | "updated",
  error: unknown,
): Promise<never> {
  const { current, rendered, key, operationId } = step;
  let undone: string;
  try {
    undone = await restoreWrittenBody(rendered, written);
  } catch {
    throw error;
  }
  const reason =
    error instanceof GuardedArgoCommandError
      ? error.output
      : error instanceof Error
        ? error.message
        : "the apply-safety preflight failed";
  const summary = `Apply-safety refused ${rendered.name} at ${rendered.revision} before any sync; ${undone}. ${reason}`;
  await recordStage(current, key, "failed", {
    operationId,
    message: `${key}: refused before sync; ${undone}`,
    evidence: [
      {
        kind: "preflight",
        operationId,
        summary: summary.slice(0, EVIDENCE_SUMMARY_LIMIT),
      },
    ],
  });
  throw ApplicationFailure.nonRetryable(
    `Apply safety refused ${rendered.name}; ${undone}, and nothing was synced`,
    "DeliveryApplySafetyRefused",
  );
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
  // A forum's first upgrade re-observes its original baseline before the
  // candidate source replaces the one that baseline fingerprinted. A resumed
  // step already recorded that intent, and the server refuses the check once
  // the stage exists, so only the first attempt runs it.
  if (stageOf(current, key) === undefined)
    await forumBaselineFence(current, recipe);
  await recordStage(current, key, "running", { operationId });
  const written = await writeBody(rendered);
  try {
    await runGuardedArgoCommand(
      ["assert-apply-safe", rendered.name, "--revision", rendered.revision],
      { operationId, application: rendered.name },
    );
  } catch (error) {
    await refuseApplySafety(
      { current, rendered, key, operationId },
      written,
      error,
    );
  }
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
 *
 * A self-hosted sync may replace the very worker running it (D8). When that
 * worker's shutdown kills the step while it still holds the lease, the step
 * fails as `DeliveryExecutorReplaced`, leaving its stage `running`, and the
 * Workflow runs it again on the replacement worker. Every other failure,
 * a Failed or Error owned operation included, fails as before.
 */
export async function sync(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  key: string,
) {
  try {
    await syncOwned(current, recipe, key);
  } catch (error) {
    if (!current.selfHosted || !interruptedByWorkerShutdown()) throw error;
    throw ApplicationFailure.create({
      type: DELIVERY_EXECUTOR_REPLACED,
      message: `The ${key} step was interrupted by its own executor's replacement; it resumes by reading back request ${deliveryOperationId(current.deployment.id)}`,
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }
}

async function syncOwned(
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
  // A retirement re-proves its host drained and unrouted immediately before
  // the sync scales it to zero, as v1 does; a requested sync only reads back.
  if (!before.requested) await workerRetirementFence(current);
  // Every attempt, resumed ones included, records the same intent before any
  // Argo effect: the server accepts it only from the executor that owns the
  // deployment under a live lease (D7), which a read cannot prove.
  await recordStage(current, key, "running", { operationId: requestId });
  if (!before.requested) {
    // A preserved world switches images only with fresh preservation proof.
    minecraftSyncFence(current, recipe);
    // A forum release replaces the prior release's terminal migration Job.
    const prune = await forumSyncPrune(current, recipe, argoRequest);
    await runGuardedArgoCommand(
      [
        "sync-managed",
        rendered.name,
        "--revision",
        rendered.revision,
        "--request-id",
        requestId,
        ...(prune ? ["--prune"] : []),
        "--timeout",
        "1200",
      ],
      { operationId: requestId, application: rendered.name },
    );
  }
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
        summary: `Owned operation ${proof.operationId} synced ${rendered.name} to ${proof.revision}; Synced and Healthy with the exact rendered source${
          proof.prunePending.length === 0
            ? ""
            : `; prune pending: ${proof.prunePending.join(", ")}`
        }`,
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
