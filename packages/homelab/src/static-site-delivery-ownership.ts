import {
  STATIC_SITE_DESTINATIONS,
  V1_STATIC_SITE_DESTINATIONS,
} from "@shepherdjerred/ops-model/static-release-targets.ts";

/** Reviewed writer cutovers only. Release versions and selections live in PG. */
export const STATIC_SITE_DELIVERY_OWNERS: Readonly<Record<string, string>> = {
  ...STATIC_SITE_DESTINATIONS,
};

export function staticSiteDeliveryOwner(
  bucket: string,
  owners = STATIC_SITE_DELIVERY_OWNERS,
): string | undefined {
  return owners[bucket];
}

/**
 * A delegated bucket activates through its reviewed environment or, until v1
 * retires at the window (WP4 deletes the v1 map), through that environment's
 * v1 predecessor, so the running v1 writer keeps working after this merges.
 */
export function assertStaticSiteDeliveryOwner(
  bucket: string,
  environmentId: string,
  owners = STATIC_SITE_DELIVERY_OWNERS,
  predecessors: Readonly<Record<string, string>> = V1_STATIC_SITE_DESTINATIONS,
): void {
  const owner = staticSiteDeliveryOwner(bucket, owners);
  // Only a reviewed destination the window renames has a predecessor.
  const renamedFrom =
    owner !== undefined &&
    owner === STATIC_SITE_DESTINATIONS[bucket] &&
    predecessors[bucket] !== owner
      ? predecessors[bucket]
      : undefined;
  if (
    owner === undefined ||
    (environmentId !== owner && environmentId !== renamedFrom)
  ) {
    throw new Error(
      `Static bucket ${bucket} is not delegated to ${environmentId} in reviewed infrastructure`,
    );
  }
}

export function staticSiteWriter(
  bucket: string,
  publicationEnabled: boolean,
  owners = STATIC_SITE_DELIVERY_OWNERS,
): "legacy" | "delivery" {
  const owner = staticSiteDeliveryOwner(bucket, owners);
  if (owner === undefined) return "legacy";
  if (!publicationEnabled)
    throw new Error(
      `Static bucket ${bucket} is delegated; immutable artifact publication is required`,
    );
  return "delivery";
}
