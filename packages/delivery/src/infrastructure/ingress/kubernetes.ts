import { DeliveryError } from "#domain/error.ts";
import { readProjectedKubernetes } from "#infrastructure/kubernetes/projected-identity.ts";
import { reportFailedRead } from "#infrastructure/kubernetes/projected-reader.ts";

export type IngressKubernetesReader = (path: string) => Promise<unknown>;
const directory = "/var/run/delivery-ingress";

/** Lazy projected, read-only identity. Health and bearer requests never load Kubernetes credentials. */
export const readIngressKubernetes: IngressKubernetesReader = async (path) => {
  const parsed = await readProjectedKubernetes(directory, path).catch(
    (error: unknown) => {
      reportFailedRead("ingress", path, error);
      return null;
    },
  );
  if (parsed === null)
    throw new DeliveryError(
      "PAUSED",
      "Private ingress identity verification is unavailable; Kubernetes read access is required for human authentication",
    );
  return parsed;
};
