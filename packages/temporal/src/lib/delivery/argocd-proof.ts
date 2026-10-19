import { z } from "zod";
import {
  DeliveryArgoSourceSchema,
  deliveryArgoParameters,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";

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
          source: SourceSchema,
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

function verifyObservedOperation(
  current: z.infer<typeof PendingReleaseObservationSchema>,
  selection: DeliverySelection,
  operationId: string,
) {
  const latest = current.status.history.reduce((left, right) =>
    left.id > right.id ? left : right,
  );
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
    !sourceMatches(latest.source)
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
