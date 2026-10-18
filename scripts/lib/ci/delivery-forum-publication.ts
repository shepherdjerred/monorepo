import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import {
  ArtifactVersionSchema,
  PublishBuildSchema,
} from "@shepherdjerred/delivery/contract";
import type {
  PublishBuild,
  QualifiedForumBundleQuery,
} from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Catalog } from "@shepherdjerred/ops-model/catalog.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";

/** A genuine CI producer retains independently verified licensed bytes by their original identity. */
export async function attachForumPublication(
  publications: readonly PublishBuild[],
  qualifiedBundle: (query: QualifiedForumBundleQuery) => Promise<unknown>,
  catalog: Catalog = SERVICE_CATALOG,
): Promise<PublishBuild[]> {
  const producer = publications.find(
    (build) => build.serviceId === "storm-forum" && build.artifacts.length > 0,
  );
  if (producer === undefined) return [...publications];
  let original;
  try {
    original = ArtifactVersionSchema.parse(
      await qualifiedBundle({
        xenforoVersion: forumBundlePolicy.xenforoVersion,
        manifestDigest: forumBundlePolicyDigest(),
      }),
    );
  } catch (error) {
    const delegated = new ServiceIndex(catalog)
      .requireById("storm-forum")
      .argoApps.some(
        (application) =>
          catalog.deliveryDelegations?.[application] !== undefined,
      );
    if (
      !delegated &&
      error instanceof DeliveryClientError &&
      error.status === 404
    )
      return [...publications];
    throw error;
  }
  if (
    original.serviceId !== "storm-forum" ||
    original.component !== "archive:forum-bundle" ||
    original.kind !== "archive" ||
    original.version !== forumBundlePolicy.xenforoVersion ||
    original.origin.kind !== "licensed-bundle" ||
    original.origin.producerSourceRevision !== original.sourceRevision ||
    original.origin.xenforoVersion !== forumBundlePolicy.xenforoVersion ||
    original.origin.manifestDigest !== forumBundlePolicyDigest() ||
    original.uri !==
      `s3://storm-forum-releases/releases/${original.digest.slice(7)}.zip`
  )
    throw new Error(
      "Forum CI requires an original independently qualified bundle matching the reviewed dependency policy",
    );
  return publications.map((build) =>
    build === producer
      ? PublishBuildSchema.parse({
          ...build,
          retainedArtifactIds: [
            ...new Set([...(build.retainedArtifactIds ?? []), original.id]),
          ],
        })
      : build,
  );
}
