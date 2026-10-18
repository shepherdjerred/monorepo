import type { Deployment } from "#generated/prisma/client.ts";
import type { Principal, WorkerRetirementClaim } from "#shared/contract.ts";
import type { Delivery } from "./delivery.ts";
import { id, type Transaction } from "./delivery-data.ts";
import { audit, lock } from "./delivery-records.ts";
import { requireStaticRootBoundary } from "./platform/static-prerequisite.ts";
import { admitControlPlaneUpgrade } from "./control-plane/lifecycle.ts";
import { readmitPlatformDeployment } from "./platform/lifecycle.ts";
import { validateWorkerRetirementClaim } from "./worker-pool/retirement.ts";

/** Recheck existing ownership and fresh external prerequisites before effects. */
export async function readmitDeployment(
  this: Delivery,
  tx: Transaction,
  row: Deployment,
  input: {
    actor: Principal;
    retirementProof: WorkerRetirementClaim | undefined;
  },
) {
  await requireStaticRootBoundary(tx, {
    row,
    catalog: this.catalog,
    repositoryId: this.repositoryId,
  });
  await admitControlPlaneUpgrade(tx, row, this.catalog);
  await readmitPlatformDeployment(tx, row, this.catalog, input.actor);
  if (row.kind === "retire-worker") {
    await lock(tx, `environment:${row.environmentId}`);
    const proof = await validateWorkerRetirementClaim(tx, {
      deployment: row,
      proof: input.retirementProof,
      running: true,
    });
    await audit(tx, input.actor, {
      action: "worker.retirement_proved",
      entityId: row.id,
      requestId: id(),
      metadata: proof,
    });
  }
}
