import { firstPartyImageRepository } from "@shepherdjerred/version-catalog/image-registry";

/** Reviewed 1Password registration; no credential values belong in source. */
export const DELIVERY_CREDENTIAL_ITEMS: {
  service: string | undefined;
  executor: string | undefined;
  argocd: string | undefined;
  observer: string | undefined;
  staticStorage: string | undefined;
  staticCache: string | undefined;
  workerRegistry: string | undefined;
  platformRegistry: string | undefined;
  platformArgocd: string | undefined;
  forumReader: string | undefined;
  forumObserver: string | undefined;
  trmnlArchiveReader: string | undefined;
  trmnlKey: string | undefined;
  /** Read-only GitHub token (field DELIVERY_GH_TOKEN) for hub commit context. */
  githubReader: string | undefined;
  /**
   * npm token (field NPM_TOKEN) that npm channel deployments publish with
   * (X12): CI's npm publish item (`CI_NPM_CREDENTIALS_ITEM`) until a
   * package-scoped token replaces it.
   */
  npmChannel: string | undefined;
} = {
  service: "ahbp4izt7fibvwdjwd4ffhiime",
  executor: "ahbp4izt7fibvwdjwd4ffhiime",
  argocd: "w7rrmm6v2agx7jk4qjsaybxaau",
  observer: "irdujpdyylkem65wnr4ibw2ggq",
  staticStorage: "l5c76kuxgqckt3xc7pmman6l4u",
  staticCache: "la7gkfl5eqtxiiv2hq3qujx2gi",
  workerRegistry: "ngzmppq52zm7sii6ato2mv3sbi",
  platformRegistry: "ngzmppq52zm7sii6ato2mv3sbi",
  platformArgocd: "orpriiyv36sxmybxe3fg4szdxq",
  forumReader: "6x57e27b4jb7fxgyx2nmhhcldq",
  forumObserver: "es5ddbihz4qeylhjt2x2iemvzi",
  trmnlArchiveReader: "542onhpijguqgaukmyvbujbu74",
  trmnlKey: "p7th6tqeel7k2sm47mrrto7oca",
  githubReader: undefined,
  npmChannel: "4fmd5otmvwcpsrxjaptrloppvu",
};

/**
 * The operator attestation identity (model X13). Its token is the Delivery
 * service item's `DELIVERY_ATTEST_TOKEN` field, which `toolkit deploy attest`
 * resolves; its principal, holding only `read` and `attest`, is an entry of
 * that item's `DELIVERY_MACHINE_CREDENTIALS`. The API refuses attestations
 * from any `execute` credential, and no executor or workload mounts this one.
 */
export const DELIVERY_ATTESTOR_CREDENTIAL = {
  itemId: "ahbp4izt7fibvwdjwd4ffhiime",
  field: "DELIVERY_ATTEST_TOKEN",
  principal: {
    id: "delivery-operator-attestor",
    kind: "machine",
    scopes: ["read", "attest"],
  },
} as const;

export type DeliveryActivation = {
  image: string;
  serviceItemId: string;
  observerItemId?: string;
  forumReaderItemId?: string;
  forumObserverItemId?: string;
  trmnlArchiveReaderItemId?: string;
  trmnlKeyItemId?: string;
  githubReaderItemId?: string;
};
export type DeliveryExecutorActivation = DeliveryActivation & {
  executorItemId: string;
  argocdItemId: string;
  staticStorageItemId?: string;
  staticCacheItemId?: string;
  workerRegistryItemId?: string;
  platformRegistryItemId?: string;
  platformArgocdItemId?: string;
  npmChannelItemId?: string;
};

/** Publication alone cannot activate a service lacking its declared credentials. */
export function deliveryActivation(): DeliveryActivation | undefined {
  const image = `${firstPartyImageRepository("delivery")}:delivery-recipe`;
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
  return service === undefined
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
        ...(DELIVERY_CREDENTIAL_ITEMS.githubReader === undefined
          ? {}
          : { githubReaderItemId: DELIVERY_CREDENTIAL_ITEMS.githubReader }),
      };
}

/** Capabilities whose credentials are issued only together. */
function requirePairedCapabilities() {
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
}

export function deliveryExecutorActivation():
  DeliveryExecutorActivation | undefined {
  requirePairedCapabilities();
  const service = deliveryActivation();
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
        ...(DELIVERY_CREDENTIAL_ITEMS.workerRegistry === undefined
          ? {}
          : { workerRegistryItemId: DELIVERY_CREDENTIAL_ITEMS.workerRegistry }),
        ...(DELIVERY_CREDENTIAL_ITEMS.staticStorage === undefined
          ? {}
          : { staticStorageItemId: DELIVERY_CREDENTIAL_ITEMS.staticStorage }),
        ...(DELIVERY_CREDENTIAL_ITEMS.staticCache === undefined
          ? {}
          : { staticCacheItemId: DELIVERY_CREDENTIAL_ITEMS.staticCache }),
        ...(DELIVERY_CREDENTIAL_ITEMS.npmChannel === undefined
          ? {}
          : { npmChannelItemId: DELIVERY_CREDENTIAL_ITEMS.npmChannel }),
      };
}
