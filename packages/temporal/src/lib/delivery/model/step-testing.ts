import { deliveryOperationId } from "@shepherdjerred/delivery/operation-id";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { renderApplication } from "./application.ts";
import type { KubernetesApplicationRecipe } from "./recipe.ts";

/**
 * Test doubles shared by the model step tests. Module mocks load them from
 * their factories (`vi.mock(path, async () => (await import(...)).x)`).
 */

/** An OCI chart whose tag still resolves to its frozen digest. */
export const frozenOciChart = {
  verifyOciChart: (chart: { id: string }, operationId: string) =>
    Promise.resolve({
      kind: "preflight",
      operationId,
      summary: `Source ${chart.id} still resolves to its frozen digest`,
    }),
};

/** A lease that never lapses: the step runs as if renewed throughout. */
export const heldLease = {
  stepLease: () => ({}),
  withLeaseRenewal: async (_lease: unknown, run: () => Promise<unknown>) =>
    await run(),
};

/** The written Application, before and after this deployment's owned sync. */
export function argoApplication(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  synced: boolean,
) {
  const rendered = renderApplication(current, recipe);
  const info = [
    {
      name: "ci.sjer.red/request-id",
      value: deliveryOperationId(current.deployment.id),
    },
    { name: "ci.sjer.red/operation-id", value: "operation-1" },
  ];
  return {
    metadata: { ...rendered.body.metadata, uid: "application-uid" },
    spec: { source: rendered.source },
    status: synced
      ? {
          sync: { status: "Synced", revision: rendered.revision },
          health: { status: "Healthy" },
          operationState: {
            phase: "Succeeded",
            operation: { info },
            syncResult: { revision: rendered.revision },
          },
        }
      : {},
  };
}
