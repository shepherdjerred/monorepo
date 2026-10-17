/** Reviewed writer cutovers only. Release versions and selections live in PG. */
export const STATIC_SITE_DELIVERY_OWNERS: Readonly<Record<string, string>> = {};

export function staticSiteDeliveryOwner(
  bucket: string,
  owners = STATIC_SITE_DELIVERY_OWNERS,
): string | undefined {
  return owners[bucket];
}

export function assertStaticSiteDeliveryOwner(
  bucket: string,
  environmentId: string,
  owners = STATIC_SITE_DELIVERY_OWNERS,
): void {
  if (staticSiteDeliveryOwner(bucket, owners) !== environmentId) {
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
