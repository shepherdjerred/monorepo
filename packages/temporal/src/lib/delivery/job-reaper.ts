import { ApiException, type V1Job } from "@kubernetes/client-node";
import { z } from "zod";

export const DELIVERY_REQUEST_ANNOTATION =
  "delivery.shepherdjerred.com/request";
export const DELIVERY_WORKER_JOBS_NAMESPACE = "delivery-worker-jobs";
export const DELIVERY_PLATFORM_JOBS_NAMESPACE = "delivery-platform-jobs";
export const MAX_CANDIDATES_PER_SWEEP = 100;

const TERMINAL_DEPLOYMENT_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
]);
const SETTLED_INTENT_STATES = new Set(["succeeded", "failed"]);

export type DeliveryJobReaperNamespace =
  | typeof DELIVERY_WORKER_JOBS_NAMESPACE
  | typeof DELIVERY_PLATFORM_JOBS_NAMESPACE;

export type TerminalDeliveryJobCandidate = {
  name: string;
  namespace: DeliveryJobReaperNamespace;
  uid: string | undefined;
  deploymentId: string;
  sortTimestampMs: number;
};

export type DeliveryJobReapResult = {
  namespace: DeliveryJobReaperNamespace;
  scanned: number;
  candidates: number;
  deleted: string[];
  skippedUnsettled: number;
};

export type DeliveryJobReaperKubernetesClient = {
  listNamespacedJob: (param: {
    namespace: string;
  }) => Promise<{ items: V1Job[] }>;
  deleteNamespacedJob: (param: {
    namespace: string;
    name: string;
    propagationPolicy?: string;
    body?: { preconditions?: { uid?: string } };
  }) => Promise<unknown>;
};

export type DeliveryJobReaperDependencies = {
  namespace: DeliveryJobReaperNamespace;
  jobs: DeliveryJobReaperKubernetesClient;
  inspectDeployment: (deploymentId: string) => Promise<unknown>;
  heartbeat?: (detail: unknown) => void;
  signal?: AbortSignal;
  maxCandidates?: number;
  sweepIndex?: number;
};

const RecoveryIntentInspectionSchema = z.object({
  outcome: z.string().optional(),
  status: z.string().optional(),
  settledAt: z.string().nullable().optional(),
  barrier: z.unknown().optional(),
  dispatchBarrier: z.unknown().optional(),
  barrierRestoredAt: z.string().nullable().optional(),
});

const SettledDeploymentInspectionSchema = z.object({
  deployment: z.object({
    id: z.string().min(1),
    status: z.string().min(1),
    recoveryRequired: z.boolean(),
    handoffAt: z.string().nullable().optional(),
  }),
  environment: z
    .object({
      activeDeploymentId: z.string().nullable(),
    })
    .optional(),
  recoveryIntents: z.array(RecoveryIntentInspectionSchema),
  contentRecoveries: z.array(RecoveryIntentInspectionSchema).default([]),
  platformRecoveries: z.array(RecoveryIntentInspectionSchema).default([]),
  minecraftRecoveries: z.array(RecoveryIntentInspectionSchema).default([]),
});

function parseTimestampMs(
  value: Date | string | undefined,
): number | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : undefined;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isTerminalJobConditionPresent(job: V1Job): boolean {
  return (
    job.status?.conditions?.some(
      (condition) =>
        (condition.type === "Complete" || condition.type === "Failed") &&
        condition.status === "True",
    ) === true
  );
}

/**
 * Selects only terminal (`Complete` or `Failed`, `active === 0`), non-deleting
 * Jobs in `expectedNamespace` carrying a non-empty `delivery.shepherdjerred.com/request`
 * annotation. Kueue-suspended or unannotated Jobs return `undefined`.
 */
export function classifyDeliveryJobCandidate(
  job: V1Job,
  expectedNamespace: DeliveryJobReaperNamespace,
): TerminalDeliveryJobCandidate | undefined {
  const metadata = job.metadata;
  const name = metadata?.name;
  const deploymentId = metadata?.annotations?.[DELIVERY_REQUEST_ANNOTATION];
  const activeCount = job.status?.active ?? 0;
  const hasName = name !== undefined && name.length > 0;
  const isDeleting = metadata?.deletionTimestamp !== undefined;
  const hasDeploymentId =
    typeof deploymentId === "string" && deploymentId.trim().length > 0;
  if (
    !hasName ||
    isDeleting ||
    activeCount !== 0 ||
    !hasDeploymentId ||
    metadata?.namespace !== expectedNamespace ||
    !isTerminalJobConditionPresent(job)
  ) {
    return undefined;
  }
  const sortTimestampMs =
    parseTimestampMs(job.status?.completionTime) ??
    parseTimestampMs(metadata.creationTimestamp) ??
    Number.MAX_SAFE_INTEGER;
  return {
    name,
    namespace: expectedNamespace,
    uid: metadata.uid,
    deploymentId,
    sortTimestampMs,
  };
}

function isRecoveryIntentSettled(
  intent: z.infer<typeof RecoveryIntentInspectionSchema>,
): boolean {
  if (intent.outcome === "pending" || intent.status === "pending") {
    return false;
  }
  const hasState = intent.outcome !== undefined || intent.status !== undefined;
  if (!hasState) {
    return false;
  }
  if (
    intent.outcome !== undefined &&
    !SETTLED_INTENT_STATES.has(intent.outcome)
  ) {
    return false;
  }
  if (
    intent.status !== undefined &&
    !SETTLED_INTENT_STATES.has(intent.status)
  ) {
    return false;
  }
  if (intent.outcome !== undefined && intent.settledAt === null) {
    return false;
  }
  const hasBarrier =
    (intent.dispatchBarrier !== undefined && intent.dispatchBarrier !== null) ||
    (intent.barrier !== undefined && intent.barrier !== null);
  return !hasBarrier || (intent.barrierRestoredAt ?? null) !== null;
}

/**
 * Fail-closed settlement check against `GET /api/v1/deployments/:id`.
 * Any schema mismatch, non-terminal deployment, `recoveryRequired: true`,
 * active/handoff state, pending recovery intent, or unrestored barrier returns `false`.
 */
export function isDeploymentSettledForJobReap(
  deploymentId: string,
  rawDetail: unknown,
): boolean {
  const parsed = SettledDeploymentInspectionSchema.safeParse(rawDetail);
  if (!parsed.success) {
    return false;
  }
  const { deployment, environment } = parsed.data;
  if (
    deployment.id !== deploymentId ||
    !TERMINAL_DEPLOYMENT_STATUSES.has(deployment.status) ||
    deployment.recoveryRequired ||
    (deployment.handoffAt ?? null) !== null ||
    environment?.activeDeploymentId === deploymentId
  ) {
    return false;
  }
  const allIntents = [
    ...parsed.data.recoveryIntents,
    ...parsed.data.contentRecoveries,
    ...parsed.data.platformRecoveries,
    ...parsed.data.minecraftRecoveries,
  ];
  return allIntents.every((intent) => isRecoveryIntentSettled(intent));
}

function httpStatusCode(error: unknown): number | undefined {
  return error instanceof ApiException
    ? error.code
    : z.object({ code: z.number() }).safeParse(error).data?.code;
}

function selectSweepWindow<T>(
  sorted: readonly T[],
  maxCandidates: number,
  sweepIndex: number,
): T[] {
  if (sorted.length <= maxCandidates) {
    return [...sorted];
  }
  const normalizedSweep = Math.abs(Math.trunc(sweepIndex));
  const offset = (normalizedSweep * maxCandidates) % sorted.length;
  return [...sorted.slice(offset), ...sorted.slice(0, offset)].slice(
    0,
    maxCandidates,
  );
}

export async function reapSettledDeliveryJobs(
  options: DeliveryJobReaperDependencies,
): Promise<DeliveryJobReapResult> {
  const { namespace } = options;
  options.heartbeat?.({ phase: "list-jobs", namespace });
  const listed = await options.jobs.listNamespacedJob({ namespace });
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES_PER_SWEEP;
  const sweepIndex = options.sweepIndex ?? Math.floor(Date.now() / 60_000);
  const sortedCandidates = listed.items
    .flatMap((job) => {
      const candidate = classifyDeliveryJobCandidate(job, namespace);
      return candidate === undefined ? [] : [candidate];
    })
    .toSorted(
      (left, right) =>
        left.sortTimestampMs - right.sortTimestampMs ||
        left.name.localeCompare(right.name),
    );
  const candidates = selectSweepWindow(
    sortedCandidates,
    maxCandidates,
    sweepIndex,
  );

  const inspectSettled = async (deploymentId: string): Promise<boolean> => {
    try {
      const detail = await options.inspectDeployment(deploymentId);
      return isDeploymentSettledForJobReap(deploymentId, detail);
    } catch {
      return false;
    }
  };

  const settlementByDeployment = new Map<string, Promise<boolean>>();
  const checkDeploymentSettled = (deploymentId: string): Promise<boolean> => {
    const cached = settlementByDeployment.get(deploymentId);
    if (cached !== undefined) {
      return cached;
    }
    const pending = inspectSettled(deploymentId);
    settlementByDeployment.set(deploymentId, pending);
    return pending;
  };

  const deleted: string[] = [];
  let skippedUnsettled = 0;

  for (const candidate of candidates) {
    if (options.signal?.aborted === true) {
      options.signal.throwIfAborted();
    }
    options.heartbeat?.({
      phase: "inspect-job",
      namespace,
      job: candidate.name,
    });
    if (!(await checkDeploymentSettled(candidate.deploymentId))) {
      skippedUnsettled += 1;
      continue;
    }
    try {
      await options.jobs.deleteNamespacedJob({
        namespace,
        name: candidate.name,
        propagationPolicy: "Background",
        ...(candidate.uid === undefined
          ? {}
          : { body: { preconditions: { uid: candidate.uid } } }),
      });
      deleted.push(candidate.name);
    } catch (error: unknown) {
      const code = httpStatusCode(error);
      if (code === 404 || code === 409) {
        continue;
      }
      throw error;
    }
  }

  return {
    namespace,
    scanned: listed.items.length,
    candidates: candidates.length,
    deleted,
    skippedUnsettled,
  };
}
