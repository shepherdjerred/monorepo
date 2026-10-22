import { DELIVERY_KUBERNETES_READERS } from "@shepherdjerred/ops-model/delivery-readers.ts";
import { DeliveryError } from "#domain/error.ts";
import { readProjectedKubernetes } from "./projected-identity.ts";

/** Where the API pod projects the `delivery-application-reader` token and cluster CA. */
export const APPLICATION_READER_DIRECTORY =
  DELIVERY_KUBERNETES_READERS.application.directory;

/** An Argo Application object as stored, or null when it does not exist. */
export type ApplicationReader = (name: string) => Promise<unknown>;

/**
 * Settlement readers observe Applications straight from the Kubernetes API
 * (D5, I2), so recovery still works while ArgoCD's own API is down or
 * upgrading itself, and the API holds no ArgoCD credential.
 */
export function createApplicationReader(
  read: (path: string) => Promise<unknown> = (path) =>
    readProjectedKubernetes(APPLICATION_READER_DIRECTORY, path),
): ApplicationReader {
  return async (name) => {
    try {
      return await read(
        `/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/${encodeURIComponent(name)}`,
      );
    } catch {
      throw new DeliveryError(
        "PAUSED",
        "Independent Application readback is unavailable; the projected delivery-application-reader identity is required",
      );
    }
  };
}
