import { DELIVERY_KUBERNETES_READERS } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { KUBERNETES_OBJECT_BOUND } from "./projected-identity.ts";
import { projectedReader, type KubernetesRead } from "./projected-reader.ts";

/** An Argo Application object as stored, or null when it does not exist. */
export type ApplicationReader = (name: string) => Promise<unknown>;

/**
 * Settlement readers observe Applications straight from the Kubernetes API
 * (D5, I2), so recovery still works while ArgoCD's own API is down or
 * upgrading itself, and settlement holds no ArgoCD credential.
 *
 * One Application is one object, so it is bounded as one: a worker
 * Application's spec, sync result and ten history entries each carry the
 * whole frozen pool, and it passes 1 MiB once the pool has about a hundred
 * hosts.
 */
export function createApplicationReader(
  read?: KubernetesRead,
): ApplicationReader {
  const applications = projectedReader(
    DELIVERY_KUBERNETES_READERS.application,
    read,
    { bound: KUBERNETES_OBJECT_BOUND },
  );
  return async (name) =>
    await applications(
      `/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/${encodeURIComponent(name)}`,
    );
}
