import type { CiStep } from "./model.ts";
import type { CacheTrustDomain } from "./cache-trust-domain.ts";
import {
  parseVersionCatalog,
  versionCatalogMap,
} from "@shepherdjerred/version-catalog";
import catalog from "@shepherdjerred/version-catalog/catalog.json" with { type: "json" };

// Like the helper code, this image comes from the deployed extension's catalog,
// never from the unverified commit requesting a checkout.
const versions = versionCatalogMap(parseVersionCatalog(catalog));
const preparationVersion = versions["library/busybox"];
if (
  preparationVersion === undefined ||
  !/@sha256:[a-f\d]{64}$/u.test(preparationVersion)
)
  throw new Error("Source cache preparation requires a pinned BusyBox image");
export const SOURCE_CACHE_PREPARATION_IMAGE = `busybox:${preparationVersion}`;

const ordinaryCloneVersion = versions["woodpeckerci/plugin-git"];
if (
  ordinaryCloneVersion === undefined ||
  !/@sha256:[a-f\d]{64}$/u.test(ordinaryCloneVersion)
)
  throw new Error("Ordinary checkout requires a pinned Git clone image");
export const ORDINARY_CLONE_IMAGE = `docker.io/woodpeckerci/plugin-git:${ordinaryCloneVersion}`;

export const SOURCE_CACHE_MAIN = "woodpecker-source-main";
export const SOURCE_CACHE_PR = "woodpecker-source-pr";
export const SOURCE_CACHE_CONTROL = "woodpecker-source-control";
export const SOURCE_CACHE_PATH = "/woodpecker/source-cache";
export const SOURCE_CACHE_CONTROL_PATH = "/woodpecker/source-control";

/**
 * Only the pinned helper image's checkout writes either claim, never the code
 * under test, so the source cache follows the trust domain rather than the
 * branch: trusted proposals share main's objects.
 */
export function cacheSourceSteps(
  steps: readonly CiStep[],
  input: {
    enabled: boolean;
    credentialless: boolean;
    trustDomain: CacheTrustDomain;
    image?: string | undefined;
  },
): CiStep[] {
  if (!input.enabled || input.credentialless || input.image === undefined)
    return [...steps];
  const image = input.image;
  return steps.map((step) =>
    step.skipClone === true || step.backend === "local"
      ? step
      : {
          ...step,
          sourceCache: {
            image,
            claim:
              input.trustDomain === "trusted"
                ? SOURCE_CACHE_MAIN
                : SOURCE_CACHE_PR,
          },
        },
  );
}
