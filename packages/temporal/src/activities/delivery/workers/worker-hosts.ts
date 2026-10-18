import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { verifyWorkerHosts as observeWorkerHosts } from "#lib/delivery/workers/worker-hosts.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";

export async function verifyWorkerHosts(
  detail: DeploymentDetail,
): Promise<void> {
  await observeWorkerHosts(detail, argoRequest);
}
