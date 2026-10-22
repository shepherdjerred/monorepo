import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "#lib/delivery/argo-client.ts";
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
    };

function requestOf(info: z.infer<typeof InfoSchema>, name: string) {
  const entries = info.filter((entry) => entry.name === name);
  return entries.length === 1 ? (entries[0]?.value ?? null) : null;
}

/**
 * Readback of the owned Application (A2): it is Delivery's for this
 * environment, carries exactly the rendered source, and its last operation
 * is this deployment's request. Settled only when that operation succeeded
 * at the exact revision and the Application is Synced and Healthy.
 */
export function applicationProgress(
  raw: unknown,
  desired: RenderedApplication,
  requestId: string,
): ApplicationProgress {
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
  if (
    operationId === null ||
    state.phase !== "Succeeded" ||
    observed.status.sync?.status !== "Synced" ||
    observed.status.health?.status !== "Healthy"
  )
    return { settled: false, uid: observed.metadata.uid, requested: true };
  if (
    observed.status.sync.revision !== desired.revision ||
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
  };
}
