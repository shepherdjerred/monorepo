import { z } from "zod";
import { DELIVERY_KUBERNETES_READERS } from "@shepherdjerred/ops-model/delivery-readers.ts";
import {
  WorkerPoolSnapshotSchema,
  WorkerRecoveryObservationSchema,
  workerHostSpecification,
  type Principal,
  type WorkerRecoveryObservation,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { findIntent } from "#infrastructure/recovery-intents.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import {
  projectedReader,
  type KubernetesRead,
} from "#infrastructure/kubernetes/projected-reader.ts";

export type WorkerRecoveryReaders = {
  /** `delivery-application-reader`. */
  readApplication: ApplicationReader;
  /** `delivery-worker-recovery-reader`. */
  readKubernetes: KubernetesRead;
};

/** The projected `delivery-worker-recovery-reader` identity. */
export function createWorkerRecoveryReader(
  read?: KubernetesRead,
): KubernetesRead {
  return projectedReader(DELIVERY_KUBERNETES_READERS.workerRecovery, read);
}

const Items = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
});
const namespaces: readonly string[] =
  DELIVERY_KUBERNETES_READERS.workerRecovery.namespaces;

/**
 * Worker recovery proves its target with the API's own readers, never the
 * executor's ArgoCD token (D5, I2): the frozen deployment's Application and
 * every Deployment and worker Pod in its pool's namespace, read fresh on each call
 * while the intent is pending. The executor relays these into its proof,
 * which the API settles under the same generation and fingerprint checks.
 */
export async function observeWorkerRecovery(
  delivery: Delivery,
  intentId: string,
  actor: Principal,
  readers: WorkerRecoveryReaders | undefined,
): Promise<WorkerRecoveryObservation> {
  requireScope(actor, "execute");
  const intent = await findIntent(delivery.database, intentId, "worker");
  if (intent.status !== "pending")
    throw new DeliveryError(
      "CONFLICT",
      "Only a pending worker recovery is observed",
    );
  if (readers === undefined)
    throw new DeliveryError(
      "PAUSED",
      "Independent worker recovery readers are not configured; keep target ownership",
    );
  const detail = await delivery.detail(intent.deploymentId);
  // The frozen pool names its fixed host; rollouts and retirements alike.
  const host = workerHostSpecification(
    WorkerPoolSnapshotSchema.parse(detail.deployment.workerSnapshot).target,
  );
  if (detail.environment.application !== host.application)
    throw new DeliveryError(
      "INVALID",
      "Worker recovery requires the pool's canonical host Application",
    );
  const namespace = host.kubernetesNamespace;
  if (!namespaces.includes(namespace))
    throw new DeliveryError(
      "INVALID",
      `Worker namespace ${namespace} has no declared recovery reader grant`,
    );
  const observed = await readers.readApplication(host.application);
  if (observed === null)
    throw new DeliveryError(
      "CONFLICT",
      `Application ${host.application} does not exist; keep target ownership`,
    );
  const [deployments, pods] = await Promise.all([
    readers.readKubernetes(`/apis/apps/v1/namespaces/${namespace}/deployments`),
    // Only worker hosts carry the family label every proof filters on.
    readers.readKubernetes(
      `/api/v1/namespaces/${namespace}/pods?labelSelector=worker-family`,
    ),
  ]);
  return WorkerRecoveryObservationSchema.parse({
    application: observed,
    deployments: Items.parse(deployments).items,
    pods: Items.parse(pods).items,
  });
}
