import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "@shepherdjerred/delivery/model-contract";
import type { RenderedApplication } from "./application.ts";

const InfoSchema = z.array(z.object({ name: z.string(), value: z.string() }));
const ObservedSchema = z.object({
  metadata: z.object({
    name: z.string(),
    uid: z.string().min(1),
    annotations: z.record(z.string(), z.string()).default({}),
  }),
  operation: z.unknown().optional(),
  spec: z.object({ source: z.unknown() }).loose(),
  status: z
    .object({
      sync: z
        .object({ status: z.string(), revision: z.string().optional() })
        .optional(),
      health: z.object({ status: z.string() }).optional(),
      resources: z
        .array(
          z.object({
            status: z.string().optional(),
            requiresPruning: z.boolean().optional(),
            group: z.string().optional(),
            kind: z.string().optional(),
            namespace: z.string().optional(),
            name: z.string().optional(),
          }),
        )
        .optional(),
      operationState: z
        .object({
          phase: z.enum([
            "Running",
            "Terminating",
            "Succeeded",
            "Failed",
            "Error",
          ]),
          message: z.string().optional(),
          operation: z.object({ info: InfoSchema.default([]) }),
          syncResult: z.object({ revision: z.string() }).optional(),
        })
        .optional(),
    })
    .default({}),
});

export type ApplicationProgress =
  | { settled: false; uid: string; requested: boolean }
  | {
      settled: true;
      uid: string;
      requested: true;
      operationId: string;
      revision: string;
      /** OutOfSync resources that are only waiting to be pruned. Never pruned here. */
      prunePending: readonly string[];
    };

function requestOf(info: z.infer<typeof InfoSchema>, name: string) {
  const entries = info.filter((entry) => entry.name === name);
  return entries.length === 1 ? (entries[0]?.value ?? null) : null;
}

/**
 * The owned Application (A2): Delivery's for this environment and carrying
 * exactly the rendered source.
 */
export function requireRenderedSource(
  raw: unknown,
  desired: Pick<RenderedApplication, "name" | "environmentId" | "source">,
) {
  const observed = ObservedSchema.parse(raw);
  if (
    observed.metadata.name !== desired.name ||
    observed.metadata.annotations[DELIVERY_ENVIRONMENT_ANNOTATION] !==
      desired.environmentId
  )
    throw new Error(
      `Application ${observed.metadata.name} is not owned by ${desired.environmentId}`,
    );
  if (canonicalJson(observed.spec.source) !== canonicalJson(desired.source))
    throw new Error(
      `Application ${desired.name} source differs from the rendered exact source`,
    );
  return observed;
}

function resourceIdentity(resource: {
  group?: string | undefined;
  kind?: string | undefined;
  namespace?: string | undefined;
  name?: string | undefined;
}): string {
  return `${resource.group ?? ""}/${resource.kind ?? "Resource"} ${resource.namespace ?? "_cluster"}/${resource.name ?? "unnamed"}`;
}

/**
 * OutOfSync is settled only when every drifted resource already asks to be
 * pruned. Missing or empty resources fail closed. This does not prune them.
 */
function prunePendingResources(
  resources:
    | readonly {
        status?: string | undefined;
        requiresPruning?: boolean | undefined;
        group?: string | undefined;
        kind?: string | undefined;
        namespace?: string | undefined;
        name?: string | undefined;
      }[]
    | undefined,
): readonly string[] | null {
  if (resources === undefined || resources.length === 0) return null;
  const drifting = resources.filter(
    (resource) => resource.status === "OutOfSync",
  );
  return drifting.length === 0 ||
    drifting.some((resource) => resource.requiresPruning !== true)
    ? null
    : drifting.map((resource) => resourceIdentity(resource));
}

/**
 * Readback of the owned Application (A2): it is Delivery's for this
 * environment, carries exactly the rendered source, and its last operation
 * is this deployment's request. Settled when that operation succeeded at the
 * exact revision, health is Healthy, and the Application is Synced — or
 * OutOfSync only because every drifted resource requires pruning.
 */
export function applicationProgress(
  raw: unknown,
  desired: RenderedApplication,
  requestId: string,
): ApplicationProgress {
  const observed = requireRenderedSource(raw, desired);
  const state = observed.status.operationState;
  if (
    state === undefined ||
    requestOf(state.operation.info, "ci.sjer.red/request-id") !== requestId
  )
    return { settled: false, uid: observed.metadata.uid, requested: false };
  if (state.phase === "Failed" || state.phase === "Error")
    throw new Error(
      `Owned sync of ${desired.name} ended ${state.phase}: ${state.message ?? "no message"}`,
    );
  const operationId = requestOf(
    state.operation.info,
    "ci.sjer.red/operation-id",
  );
  const syncStatus = observed.status.sync?.status;
  const prunePending =
    syncStatus === "Synced"
      ? []
      : syncStatus === "OutOfSync"
        ? prunePendingResources(observed.status.resources)
        : null;
  if (
    operationId === null ||
    prunePending === null ||
    state.phase !== "Succeeded" ||
    observed.status.health?.status !== "Healthy"
  )
    return { settled: false, uid: observed.metadata.uid, requested: true };
  if (
    observed.status.sync?.revision !== desired.revision ||
    state.syncResult?.revision !== desired.revision
  )
    throw new Error(
      `Application ${desired.name} synced a revision other than ${desired.revision}`,
    );
  return {
    settled: true,
    uid: observed.metadata.uid,
    requested: true,
    operationId,
    revision: desired.revision,
    prunePending,
  };
}
