import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
  effectSignal,
  interruptedByWorkerShutdown,
} from "#lib/delivery/model/effect-signal.ts";
import type { DeliveryModelStepResult } from "#shared/delivery-executor.ts";
import { createHash } from "node:crypto";
import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { ManagedResourcesSchema } from "homelab/scripts/argocd/argocd-apply-safety.ts";
import {
  hasLiveLegacyMediaIngresses,
  MEDIA_INGRESS_PRUNE_FLAG,
} from "homelab/scripts/argocd/argocd-media-ingress-prunes.ts";
import {
  SyncedArgoHistorySchema,
  latestArgoSyncedHistory,
  unchangedArgoHistoryId,
} from "#lib/delivery/argocd-proof.ts";
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
import { credentialSyncPrunes } from "#lib/delivery/credential-prune.ts";
import { workerSyncPrunes } from "#lib/delivery/workers/worker-prune.ts";
import { alertDashboardSyncPrunes } from "#lib/delivery/alert-dashboard/prune.ts";
import { renderedRelease } from "#lib/delivery/retired-route-prune.ts";

const READBACK_ATTEMPTS = 120;
const READBACK_INTERVAL_MS = 5000;
/** The Delivery API caps an evidence summary at 4000 chars; chunk below it. */
const EVIDENCE_SUMMARY_BUDGET = 3500;

function reconciliationEvidence(
  proof: Extract<ReturnType<typeof applicationProgress>, { settled: true }>,
  rendered: RenderedApplication,
): EvidenceInput[] {
  const base = `Owned operation ${proof.operationId} synced ${rendered.name} to ${proof.revision}; Synced and Healthy with the exact rendered source`;
  if (proof.prunePending.length === 0)
    return [
      { kind: "reconciliation", operationId: proof.operationId, summary: base },
    ];
  const summaries: string[] = [];
  let prefix = `${base}; prune pending (${proof.prunePending.length.toString()}): `;
  let current = prefix;
  for (const identity of proof.prunePending) {
    let entry = current === prefix ? identity : `, ${identity}`;
    if (current.length + entry.length > EVIDENCE_SUMMARY_BUDGET) {
      summaries.push(current);
      prefix = `Owned operation ${proof.operationId} prune pending (continued): `;
      current = prefix;
      entry = identity;
    }
    const room = EVIDENCE_SUMMARY_BUDGET - current.length;
    current +=
      entry.length <= room
        ? entry
        : `${entry.slice(0, Math.max(0, room - 1))}…`;
  }
  summaries.push(current);
  return summaries.map((summary) => ({
    kind: "reconciliation" as const,
    operationId: proof.operationId,
    summary,
  }));
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
    return await verifyOciChart(artifact, operationId, effectSignal());
  if (!artifact.uri.startsWith("https://"))
    return {
      kind: "preflight",
      operationId,
      summary: `Source ${artifact.id} ${artifact.version} is bound by its recorded digest ${artifact.digest}; its store serves it by version`,
    };
  const response = await fetch(artifact.uri, {
    signal: AbortSignal.any([effectSignal(), AbortSignal.timeout(30_000)]),
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

function readCandidateApplication(rendered: RenderedApplication) {
  return getArgoApplication(rendered.name, {
    signal: effectSignal(),
    project: rendered.body.spec.project,
  });
}

/** Create when absent; otherwise replace the whole body under CAS and ownership (T2). */
async function writeBody(
  rendered: RenderedApplication,
  onPriorRead?: (prior: unknown) => void,
): Promise<"created" | "updated"> {
  const current = await readCandidateApplication(rendered);
  onPriorRead?.(current);
  if (current === null) {
    await createArgoApplication(rendered.body, { signal: effectSignal() });
    return "created";
  }
  const observed = SyncedArgoHistorySchema.parse(current);
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
    { signal: effectSignal() },
  );
  return "updated";
}

type ApplySafetyStep = {
  current: DeploymentDetail;
  rendered: RenderedApplication;
  key: string;
  operationId: string;
};

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
      { signal: effectSignal() },
    );
    return "removed the Application it had created";
  }
  const current = SyncedArgoHistorySchema.parse(
    await readCandidateApplication(rendered),
  );
  const latest = latestArgoSyncedHistory(current.status?.history);
  if (latest === null)
    throw new Error(
      `Application ${rendered.name} has no synced source to restore`,
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
    { signal: effectSignal() },
  );
  return `restored the source Argo last synced (history ${latest.id.toString()})`;
}

const EVIDENCE_SUMMARY_LIMIT = 4000;

async function settleRefusedApplySafety(
  step: ApplySafetyStep,
  outcome: string,
  error: unknown,
): Promise<never> {
  const { current, rendered, key, operationId } = step;
  const reason =
    error instanceof GuardedArgoCommandError
      ? error.output
      : error instanceof Error
        ? error.message
        : "the apply-safety preflight failed";
  const summary = `Apply-safety refused ${rendered.name} at ${rendered.revision} before any sync; ${outcome}. ${reason}`;
  await recordStage(current, key, "failed", {
    operationId,
    message: `${key}: refused before sync; ${outcome}`,
    evidence: [
      {
        kind: "preflight",
        operationId,
        summary: summary.slice(0, EVIDENCE_SUMMARY_LIMIT),
      },
    ],
  });
  throw ApplicationFailure.nonRetryable(
    `Apply safety refused ${rendered.name}; ${outcome}, and nothing was synced`,
    "DeliveryApplySafetyRefused",
  );
}

/**
 * When `writeBody` itself failed before any sync, read back the Application:
 * if it was absent beforehand and is still absent, or its full body matches
 * `prior` and its `spec.source` still canonically matches the latest
 * `status.history` entry with no active operation, no candidate body landed.
 */
async function proveUnwrittenBody(
  rendered: RenderedApplication,
  priorRead: { read: false } | { read: true; value: unknown },
): Promise<string | null> {
  if (!priorRead.read) return null;
  let raw: unknown;
  try {
    raw = await readCandidateApplication(rendered);
  } catch {
    return null;
  }
  if (raw === null)
    return priorRead.value === null
      ? "the Application was never created"
      : null;
  const historyId = unchangedArgoHistoryId(raw, priorRead.value, rendered.name);
  return historyId === null
    ? null
    : `Application body is unchanged and spec.source matches history ${historyId.toString()}`;
}

async function writeBodyOrRefuse(
  step: ApplySafetyStep,
): Promise<"created" | "updated"> {
  let priorRead: { read: false } | { read: true; value: unknown } = {
    read: false,
  };
  try {
    return await writeBody(step.rendered, (value) => {
      priorRead = { read: true, value };
    });
  } catch (error) {
    const unchanged = await proveUnwrittenBody(step.rendered, priorRead);
    if (unchanged === null) throw error;
    return await settleRefusedApplySafety(step, unchanged, error);
  }
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
  const step = { current, rendered, key, operationId };
  const written = await writeBodyOrRefuse(step);
  try {
    await runGuardedArgoCommand(
      ["assert-apply-safe", rendered.name, "--revision", rendered.revision],
      { operationId, application: rendered.name },
    );
  } catch (error) {
    // Nothing was synced: undo the write and settle failed (AI-446, AI-439);
    // only if the undo itself fails does the stage stay running for recovery.
    const undone = await restoreWrittenBody(rendered, written).catch(() => {
      throw error;
    });
    await settleRefusedApplySafety(step, undone, error);
  }
  const bodySha = createHash("sha256")
    .update(canonicalJson(rendered.body))
    .digest("hex");
  await recordStage(current, key, "succeeded", {
    operationId,
    evidence: [
      source,
      {
        kind: "preflight",
        operationId,
        summary: `Application ${rendered.name} ${written} from the recipe's full body (sha256 ${bodySha}); managed resources at ${rendered.revision} are apply-safe`,
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
    const raw = await getArgoApplication(rendered.name, {
      signal: effectSignal(),
    });
    if (raw === null)
      throw new Error(`Application ${rendered.name} disappeared while syncing`);
    const progress = applicationProgress(raw, rendered, requestId);
    if (incarnation !== undefined && incarnation !== progress.uid)
      throw new Error("Application incarnation changed while waiting");
    incarnation = progress.uid;
    if (progress.settled) {
      if (progress.mediaIngressRetirement !== true) return progress;
      const clean = await settledMediaIngressRetirement(
        rendered,
        requestId,
        progress,
      );
      if (clean !== null) return clean;
    }
    Context.current().heartbeat({ requestId, attempt });
    await Bun.sleep(READBACK_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${rendered.name} to settle Synced and Healthy`,
  );
}

async function settledMediaIngressRetirement(
  rendered: RenderedApplication,
  requestId: string,
  previous: Extract<ReturnType<typeof applicationProgress>, { settled: true }>,
) {
  const app = encodeURIComponent(rendered.name);
  const refreshed = applicationProgress(
    await argoRequest(`${app}?refresh=hard`),
    rendered,
    requestId,
  );
  if (refreshed.uid !== previous.uid)
    throw new Error("Application incarnation changed while waiting");
  if (!refreshed.settled) return null;
  if (
    refreshed.operationId !== previous.operationId ||
    refreshed.mediaIngressRetirement !== true
  )
    throw new Error(
      "Owned Media ingress prune operation changed while waiting",
    );
  const managed = ManagedResourcesSchema.parse(
    await argoRequest(`${app}/managed-resources`),
  ).items;
  return hasLiveLegacyMediaIngresses(managed) ? null : refreshed;
}

/**
 * The sync step: the guarded, request-identified sync of the rendered source
 * and its readback proof. A resumed step whose request already reached the
 * Application only reads back; it never syncs twice.
 *
 * A self-hosted sync may replace the very worker running it (D8). When that
 * worker's shutdown kills the step while it still holds the lease, the step
 * returns `{ waiting: false, executorReplaced: true }`, leaving its stage
 * `running`, and the Workflow runs it again on the replacement worker without
 * recording an Activity failure. Every other failure, a Failed or Error owned
 * operation included, fails as before.
 */
export async function sync(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  key: string,
): Promise<DeliveryModelStepResult> {
  try {
    await syncOwned(current, recipe, key);
    return { waiting: false };
  } catch (error) {
    if (!current.selfHosted || !interruptedByWorkerShutdown()) throw error;
    const requestId = deliveryOperationId(current.deployment.id);
    Context.current().log.info(
      `The ${key} step was interrupted by its own executor's replacement; it resumes by reading back request ${requestId}`,
      error instanceof Error ? { cause: error.message } : {},
    );
    return { waiting: false, executorReplaced: true };
  }
}

async function syncOwned(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  key: string,
) {
  const rendered = renderApplication(current, recipe);
  const requestId = deliveryOperationId(current.deployment.id);
  const raw = await getArgoApplication(rendered.name, {
    signal: effectSignal(),
  });
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
    // A forum release replaces the prior release's terminal migration Job;
    // Hub's release removes its retired alerts and ops Ingresses; a worker
    // release removes the hosts earlier retirements scaled to zero.
    const applicationPrune = (await forumSyncPrune(
      current,
      recipe,
      argoRequest,
    ))
      ? true
      : await credentialSyncPrunes(
          {
            ...rendered,
            namespace: rendered.body.spec.destination.namespace,
          },
          argoRequest,
        );
    const prune =
      applicationPrune === false
        ? (await alertDashboardSyncPrunes(
            renderedRelease(rendered),
            argoRequest,
          )) || (await workerSyncPrunes(current, rendered, argoRequest))
        : applicationPrune;
    await runGuardedArgoCommand(
      [
        "sync-managed",
        rendered.name,
        "--revision",
        rendered.revision,
        "--request-id",
        requestId,
        ...(prune === false ? [] : ["--prune"]),
        ...(typeof prune === "boolean"
          ? []
          : [MEDIA_INGRESS_PRUNE_FLAG, JSON.stringify(prune)]),
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
    evidence: reconciliationEvidence(proof, rendered),
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
    { signal: effectSignal() },
  );
}
