/** Reviewed 1Password registration; no credential values belong in source. */
export const DELIVERY_CREDENTIAL_ITEMS: {
  service: string | undefined;
  executor: string | undefined;
  argocd: string | undefined;
  observer: string | undefined;
  staticStorage: string | undefined;
  staticCache: string | undefined;
  workerRegistry: string | undefined;
  minecraftRegistry: string | undefined;
  platformRegistry: string | undefined;
  platformArgocd: string | undefined;
  forumReader: string | undefined;
  forumObserver: string | undefined;
  trmnlArchiveReader: string | undefined;
  trmnlKey: string | undefined;
} = {
  service: "ahbp4izt7fibvwdjwd4ffhiime",
  executor: "ahbp4izt7fibvwdjwd4ffhiime",
  argocd: undefined,
  observer: undefined,
  staticStorage: undefined,
  staticCache: undefined,
  workerRegistry: undefined,
  minecraftRegistry: undefined,
  platformRegistry: undefined,
  platformArgocd: undefined,
  forumReader: undefined,
  forumObserver: undefined,
  trmnlArchiveReader: undefined,
  trmnlKey: undefined,
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
  observerItemId?: string;
  forumReaderItemId?: string;
  forumObserverItemId?: string;
  trmnlArchiveReaderItemId?: string;
  trmnlKeyItemId?: string;
};
export type DeliveryExecutorActivation = DeliveryActivation & {
  executorItemId: string;
  argocdItemId: string;
  staticStorageItemId?: string;
  staticCacheItemId?: string;
  workerRegistryItemId?: string;
  minecraftRegistryItemId?: string;
  platformRegistryItemId?: string;
  platformArgocdItemId?: string;
};

/** Publication alone cannot activate a service lacking its declared credentials. */
export function deliveryActivation(
  version: string,
): DeliveryActivation | undefined {
  const image = deliveryImageReference(version);
  if (
    (DELIVERY_CREDENTIAL_ITEMS.trmnlArchiveReader === undefined) !==
    (DELIVERY_CREDENTIAL_ITEMS.trmnlKey === undefined)
  )
    throw new Error(
      "TRMNL capability requires its exact archive reader and plugin API key together",
    );
  if (
    (DELIVERY_CREDENTIAL_ITEMS.forumReader === undefined) !==
    (DELIVERY_CREDENTIAL_ITEMS.forumObserver === undefined)
  )
    throw new Error(
      "Forum capability requires both its restricted archive reader and runtime observer registrations",
    );
  const { service, observer } = DELIVERY_CREDENTIAL_ITEMS;
  return image === undefined || service === undefined
    ? undefined
    : {
        image,
        serviceItemId: service,
        ...(observer === undefined ? {} : { observerItemId: observer }),
        ...(DELIVERY_CREDENTIAL_ITEMS.forumReader === undefined
          ? {}
          : { forumReaderItemId: DELIVERY_CREDENTIAL_ITEMS.forumReader }),
        ...(DELIVERY_CREDENTIAL_ITEMS.forumObserver === undefined
          ? {}
          : { forumObserverItemId: DELIVERY_CREDENTIAL_ITEMS.forumObserver }),
        ...(DELIVERY_CREDENTIAL_ITEMS.trmnlArchiveReader === undefined
          ? {}
          : {
              trmnlArchiveReaderItemId:
                DELIVERY_CREDENTIAL_ITEMS.trmnlArchiveReader,
            }),
        ...(DELIVERY_CREDENTIAL_ITEMS.trmnlKey === undefined
          ? {}
          : { trmnlKeyItemId: DELIVERY_CREDENTIAL_ITEMS.trmnlKey }),
      };
}

export function deliveryExecutorActivation(
  version: string,
): DeliveryExecutorActivation | undefined {
  if (
    (DELIVERY_CREDENTIAL_ITEMS.platformRegistry === undefined) !==
    (DELIVERY_CREDENTIAL_ITEMS.platformArgocd === undefined)
  )
    throw new Error(
      "Platform execution requires both its registry reader and issued dedicated ArgoCD account item",
    );
  if (
    (DELIVERY_CREDENTIAL_ITEMS.staticStorage === undefined) !==
    (DELIVERY_CREDENTIAL_ITEMS.staticCache === undefined)
  )
    throw new Error(
      "Static activation requires both storage and cache purge credentials",
    );
  const service = deliveryActivation(version);
  const executorItemId = DELIVERY_CREDENTIAL_ITEMS.executor;
  const argocdItemId = DELIVERY_CREDENTIAL_ITEMS.argocd;
  return service === undefined ||
    executorItemId === undefined ||
    argocdItemId === undefined
    ? undefined
    : {
        ...service,
        executorItemId,
        argocdItemId,
        ...(DELIVERY_CREDENTIAL_ITEMS.platformRegistry === undefined
          ? {}
          : {
              platformRegistryItemId:
                DELIVERY_CREDENTIAL_ITEMS.platformRegistry,
            }),
        ...(DELIVERY_CREDENTIAL_ITEMS.platformArgocd === undefined
          ? {}
          : { platformArgocdItemId: DELIVERY_CREDENTIAL_ITEMS.platformArgocd }),
        ...(DELIVERY_CREDENTIAL_ITEMS.minecraftRegistry === undefined
          ? {}
          : {
              minecraftRegistryItemId:
                DELIVERY_CREDENTIAL_ITEMS.minecraftRegistry,
            }),
        ...(DELIVERY_CREDENTIAL_ITEMS.workerRegistry === undefined
          ? {}
          : { workerRegistryItemId: DELIVERY_CREDENTIAL_ITEMS.workerRegistry }),
        ...(DELIVERY_CREDENTIAL_ITEMS.staticStorage === undefined
          ? {}
          : { staticStorageItemId: DELIVERY_CREDENTIAL_ITEMS.staticStorage }),
        ...(DELIVERY_CREDENTIAL_ITEMS.staticCache === undefined
          ? {}
          : { staticCacheItemId: DELIVERY_CREDENTIAL_ITEMS.staticCache }),
      };
}
