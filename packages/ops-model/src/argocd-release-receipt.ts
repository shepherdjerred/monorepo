import { z } from "zod";
import { ArgoApplicationStatusSchema } from "@shepherdjerred/ops-model/argocd-application-status.ts";

export const VERIFIED_ROOT_RELEASE_ANNOTATION =
  "ops.sjer.red/verified-root-release";

export const VerifiedRootReleaseReceiptSchema = z.object({
  schema: z.literal("homelab-verified-root-release/v1"),
  outcome: z.literal("applied-verified"),
  rootApplication: z.literal("apps"),
  requestId: z.uuid(),
  operationId: z.uuid(),
  revision: z.string().regex(/^2\.0\.0-\d+$/u),
  operationStartedAt: z.iso.datetime(),
  operationFinishedAt: z.iso.datetime(),
  verifiedAt: z.iso.datetime(),
  finalHealth: z.literal(
    "published-applications-synced-healthy-retained-applications-observed",
  ),
});

export const RootReleaseApplicationSchema = z.object({
  metadata: z.object({
    name: z.string(),
    resourceVersion: z.string().optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  status: ArgoApplicationStatusSchema.extend({
    operationState: z
      .object({
        phase: z.string(),
        message: z.string().optional(),
        startedAt: z.string(),
        finishedAt: z.string().optional(),
        operation: z
          .object({
            info: z
              .array(z.object({ name: z.string(), value: z.string() }))
              .optional(),
            initiatedBy: z
              .object({ username: z.string().optional() })
              .optional(),
            sync: z
              .object({
                revision: z.string().optional(),
                prune: z.boolean().optional(),
              })
              .optional(),
          })
          .optional(),
        syncResult: z
          .object({
            revision: z.string().optional(),
            resources: z
              .array(
                z.object({
                  status: z.string().optional(),
                  hookPhase: z.string().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      })
      .optional(),
  }).default({}),
});

export type VerifiedRootReleaseReceipt = z.infer<
  typeof VerifiedRootReleaseReceiptSchema
>;

type OperationState = NonNullable<
  z.infer<typeof RootReleaseApplicationSchema>["status"]["operationState"]
>;

function matchesOwnedPrune(
  state: OperationState,
  receipt: VerifiedRootReleaseReceipt,
): boolean {
  const operation = state.operation;
  if (operation === undefined) return false;
  const owns = (name: string, expected: string) => {
    const entries = (operation.info ?? []).filter(
      (entry) => entry.name === name,
    );
    return entries.length === 1 && entries[0]?.value === expected;
  };
  return (
    operation.initiatedBy?.username === "woodpecker" &&
    operation.sync?.revision === receipt.revision &&
    operation.sync.prune === true &&
    owns("ci.sjer.red/request-id", receipt.requestId) &&
    owns("ci.sjer.red/operation-id", receipt.operationId) &&
    owns("ci.sjer.red/revision", receipt.revision) &&
    owns("ci.sjer.red/release-phase", "prune")
  );
}

function hasSuccessfulResults(
  state: OperationState,
  revision: string,
): boolean {
  return (
    state.syncResult?.revision === revision &&
    !(state.syncResult.resources ?? []).some(
      (resource) =>
        resource.status === "SyncFailed" ||
        resource.hookPhase === "Failed" ||
        resource.hookPhase === "Error",
    )
  );
}

/** A receipt exempts only its exact verified termination, never current health. */
export function isVerifiedRootReleaseTermination(input: unknown): boolean {
  const app = RootReleaseApplicationSchema.parse(input);
  const encoded = app.metadata.annotations?.[VERIFIED_ROOT_RELEASE_ANNOTATION];
  if (encoded === undefined) return false;
  const receipt = VerifiedRootReleaseReceiptSchema.parse(JSON.parse(encoded));
  const state = app.status.operationState;
  return (
    state !== undefined &&
    app.metadata.name === receipt.rootApplication &&
    app.status.sync?.status === "Synced" &&
    app.status.sync.revision === receipt.revision &&
    state.phase === "Failed" &&
    state.message === "Operation terminated" &&
    state.startedAt === receipt.operationStartedAt &&
    state.finishedAt === receipt.operationFinishedAt &&
    Date.parse(receipt.operationFinishedAt) >=
      Date.parse(receipt.operationStartedAt) &&
    Date.parse(receipt.verifiedAt) >= Date.parse(receipt.operationFinishedAt) &&
    matchesOwnedPrune(state, receipt) &&
    hasSuccessfulResults(state, receipt.revision)
  );
}
