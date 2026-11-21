import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  DeliveryArgoSourceSchema,
  deliveryArgoParameters,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";

/** Identity metadata shared by native owned-resource proofs. */
export const ArgoResourceSchema = z.object({
  apiVersion: z.string().min(1),
  kind: z.string().min(1),
  metadata: z.object({
    name: z.string().min(1),
    namespace: z.string().optional(),
    uid: z.string().min(1).optional(),
    deletionTimestamp: z.string().optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

const SourceSchema = DeliveryArgoSourceSchema.refine(
  (source) =>
    source.helm?.parameters?.every(
      (parameter) => parameter.forceString === true,
    ) ?? true,
  "Accepted Delivery parameters must explicitly force string values",
);
export const SettledArgoStatusSchema = z.object({
  sync: z.object({ status: z.literal("Synced"), revision: z.string() }),
  health: z.object({ status: z.literal("Healthy") }),
  operationState: z.object({
    phase: z.literal("Succeeded"),
    finishedAt: z.iso.datetime({ offset: true }),
  }),
});
const ObservationSchema = z.object({
  operation: z.null().optional(),
  spec: z.object({ source: SourceSchema }),
  status: SettledArgoStatusSchema.extend({
    operationState: SettledArgoStatusSchema.shape.operationState.extend({
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
      syncResult: z.object({ revision: z.string() }),
    }),
    history: z
      .array(
        z.object({
          id: z.number(),
          revision: z.string(),
          source: DeliveryArgoSourceSchema,
        }),
      )
      .min(1),
  }),
});

const OperationObservationSchema = ObservationSchema.extend({
  status: ObservationSchema.shape.status.extend({
    health: z.object({ status: z.enum(["Healthy", "Progressing"]) }),
  }),
});
const PendingReleaseObservationSchema = OperationObservationSchema.extend({
  status: OperationObservationSchema.shape.status.extend({
    sync: SettledArgoStatusSchema.shape.sync.extend({
      status: z.enum(["Synced", "OutOfSync"]),
    }),
  }),
});
const PrunePendingObservationSchema = ObservationSchema.extend({
  status: ObservationSchema.shape.status.extend({
    sync: SettledArgoStatusSchema.shape.sync.extend({
      status: z.enum(["Synced", "OutOfSync"]),
    }),
  }),
});
const PrunePendingResourcesSchema = z.object({
  status: z.object({
    sync: z.object({ status: z.literal("OutOfSync") }),
    resources: z
      .array(
        z.object({
          status: z.string().optional(),
          requiresPruning: z.boolean().optional(),
        }),
      )
      .min(1),
  }),
});

/**
 * True when an Application is `OutOfSync` solely because one or more obsolete
 * resources await pruning (`requiresPruning: true`). Missing or empty
 * `status.resources`, zero `OutOfSync` entries, or any `OutOfSync` entry
 * without `requiresPruning === true` returns false (fails closed).
 */
export function isPruneOnlyOutOfSync(raw: unknown): boolean {
  const parsed = PrunePendingResourcesSchema.safeParse(raw);
  if (!parsed.success) return false;
  const drifting = parsed.data.status.resources.filter(
    (resource) => resource.status === "OutOfSync",
  );
  return (
    drifting.length > 0 &&
    drifting.every((resource) => resource.requiresPruning === true)
  );
}

function verifyObservedOperation(
  current: z.infer<typeof PendingReleaseObservationSchema>,
  selection: DeliverySelection,
  operationId: string,
) {
  const latest = current.status.history.reduce((left, right) =>
    left.id > right.id ? left : right,
  );
  // Older entries predate Delivery's string-typed parameter contract. Only the
  // selected latest entry can prove this release and must satisfy that contract.
  const latestSource = SourceSchema.parse(latest.source);
  const expectedParameters = Object.fromEntries(
    deliveryArgoParameters(selection.parameters).map(({ name, value }) => [
      name,
      value,
    ]),
  );
  const sourceMatches = (source: z.infer<typeof SourceSchema>) =>
    source.repoURL === selection.repository &&
    source.chart === selection.chart &&
    source.targetRevision === selection.revision &&
    JSON.stringify(
      Object.fromEntries(
        (source.helm?.parameters ?? [])
          .map(({ name, value }): [string, string] => [name, value])
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    ) === JSON.stringify(expectedParameters);
  const requests = current.status.operationState.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  if (
    requests.length !== 1 ||
    requests[0]?.value !== operationId ||
    current.status.sync.revision !== selection.revision ||
    current.status.operationState.syncResult.revision !== selection.revision ||
    latest.revision !== selection.revision ||
    !sourceMatches(current.spec.source) ||
    !sourceMatches(latestSource)
  )
    throw new Error(
      "Argo observation does not prove the exact owned selected release",
    );
  const operationIds = current.status.operationState.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/operation-id",
  );
  if (operationIds.length !== 1)
    throw new Error("Argo operation receipt has no unique operation identity");
  return {
    requestId: operationId,
    operationId: z.uuid().parse(operationIds[0]?.value),
    revision: selection.revision,
  };
}

/** Observe only a settled owned operation; Progressing is not release acceptance. */
export function observeArgoRelease(
  input: unknown,
  selection: DeliverySelection,
  operationId: string,
) {
  const current = OperationObservationSchema.parse(input);
  return {
    ...verifyObservedOperation(current, selection, operationId),
    health: current.status.health.status,
  };
}

/** Pending release readback is observation only; final acceptance remains strict. */
export function observePendingArgoRelease(
  input: unknown,
  selection: DeliverySelection,
  operationId: string,
) {
  const current = PendingReleaseObservationSchema.parse(input);
  return {
    ...verifyObservedOperation(current, selection, operationId),
    sync: current.status.sync.status,
    health: current.status.health.status,
  };
}

export function verifyArgoRelease(
  input: unknown,
  selection: DeliverySelection,
  operationId: string,
) {
  return verifyObservedOperation(
    ObservationSchema.parse(input),
    selection,
    operationId,
  );
}

/**
 * Verifies an owned release receipt where `workerSyncPrunes` intentionally
 * synced with `prune: false`, leaving obsolete resources prune-pending
 * (`AI-792`). Accepts `Synced`, or `OutOfSync` only when `status.resources`
 * proves every `OutOfSync` resource has `requiresPruning === true`.
 */
export function verifyPrunePendingArgoRelease(
  input: unknown,
  selection: DeliverySelection,
  operationId: string,
) {
  const current = PrunePendingObservationSchema.parse(input);
  if (current.status.sync.status !== "Synced" && !isPruneOnlyOutOfSync(input))
    throw new Error("Operated worker recovery requires a Synced Application");
  return verifyObservedOperation(current, selection, operationId);
}

const SyncedHistoryEntrySchema = z.object({
  id: z.number(),
  source: z.record(z.string(), z.unknown()),
});
export const SyncedArgoHistorySchema = z
  .object({
    metadata: z.object({
      name: z.string().min(1).optional(),
      resourceVersion: z.string().min(1),
    }),
    operation: z.null().optional(),
    spec: z
      .object({ source: z.record(z.string(), z.unknown()).optional() })
      .loose()
      .optional(),
    status: z
      .object({
        operationState: z.object({ phase: z.string() }).optional(),
        history: z.array(SyncedHistoryEntrySchema).optional(),
      })
      .optional(),
  })
  .loose();

export function latestArgoSyncedHistory(
  history: readonly z.infer<typeof SyncedHistoryEntrySchema>[] | undefined,
) {
  if (history === undefined) return null;
  const first = history[0];
  return first === undefined
    ? null
    : history.reduce(
        (left, right) => (left.id > right.id ? left : right),
        first,
      );
}

/**
 * Returns the latest `status.history` entry ID when `raw` is a quiescent
 * Application named `name` whose `spec.source` still canonically matches that
 * latest synced entry; otherwise returns `null`.
 */
export function unchangedArgoHistoryId(
  raw: unknown,
  name: string,
): number | null {
  const parsed = SyncedArgoHistorySchema.safeParse(raw);
  if (!parsed.success || parsed.data.metadata.name !== name) return null;
  const phase = parsed.data.status?.operationState?.phase ?? "";
  const latest = latestArgoSyncedHistory(parsed.data.status?.history);
  const source = parsed.data.spec?.source;
  if (
    latest === null ||
    source === undefined ||
    ["Running", "Terminating"].includes(phase)
  )
    return null;
  return canonicalJson(source) === canonicalJson(latest.source)
    ? latest.id
    : null;
}
