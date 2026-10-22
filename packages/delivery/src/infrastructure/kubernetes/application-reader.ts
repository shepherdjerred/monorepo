import { DELIVERY_KUBERNETES_READERS } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { projectedReader, type KubernetesRead } from "./projected-reader.ts";

/** An Argo Application object as stored, or null when it does not exist. */
export type ApplicationReader = (name: string) => Promise<unknown>;

/**
 * Settlement readers observe Applications straight from the Kubernetes API
 * (D5, I2), so recovery still works while ArgoCD's own API is down or
 * upgrading itself, and settlement holds no ArgoCD credential.
 */
export function createApplicationReader(
  read?: KubernetesRead,
): ApplicationReader {
  const applications = projectedReader(
    DELIVERY_KUBERNETES_READERS.application,
    read,
  );
  return async (name) =>
    await applications(
      `/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/${encodeURIComponent(name)}`,
    );
}
