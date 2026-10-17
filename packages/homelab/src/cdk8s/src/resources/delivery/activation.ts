/** Reviewed 1Password registration; no credential values belong in source. */
export const DELIVERY_CREDENTIAL_ITEMS: {
  service: string | undefined;
  executor: string | undefined;
  argocd: string | undefined;
  tailscale: string | undefined;
  observer: string | undefined;
} = {
  service: "ahbp4izt7fibvwdjwd4ffhiime",
  executor: "ahbp4izt7fibvwdjwd4ffhiime",
  argocd: undefined,
  tailscale: undefined,
  observer: undefined,
};

export function deliveryImageReference(version: string): string | undefined {
  if (version === `0.0.0@sha256:${"0".repeat(64)}`) return undefined;
  const digest =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?@(sha256:[a-f0-9]{64})$/u.exec(
      version,
    )?.[1];
  if (digest === undefined || digest === `sha256:${"0".repeat(64)}`)
    throw new Error("Delivery requires a published immutable image digest");
  return `docker.io/shepherdjerred/delivery@${digest}`;
}

export type DeliveryActivation = {
  image: string;
  serviceItemId: string;
  tailscaleItemId: string;
  observerItemId?: string;
};
export type DeliveryExecutorActivation = DeliveryActivation & {
  executorItemId: string;
  argocdItemId: string;
};

/** Publication alone cannot activate a service lacking its declared credentials. */
export function deliveryActivation(
  version: string,
): DeliveryActivation | undefined {
  const image = deliveryImageReference(version);
  const { service, tailscale, observer } = DELIVERY_CREDENTIAL_ITEMS;
  return image === undefined || service === undefined || tailscale === undefined
    ? undefined
    : {
        image,
        serviceItemId: service,
        tailscaleItemId: tailscale,
        ...(observer === undefined ? {} : { observerItemId: observer }),
      };
}

export function deliveryExecutorActivation(
  version: string,
): DeliveryExecutorActivation | undefined {
  const service = deliveryActivation(version);
  const executorItemId = DELIVERY_CREDENTIAL_ITEMS.executor;
  const argocdItemId = DELIVERY_CREDENTIAL_ITEMS.argocd;
  return service === undefined ||
    executorItemId === undefined ||
    argocdItemId === undefined
    ? undefined
    : { ...service, executorItemId, argocdItemId };
}
