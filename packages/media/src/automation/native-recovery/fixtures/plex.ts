import { readNativePlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import type { NativeRecoveryObserverContext } from "#migration/native-network/producer.ts";
import { createNativePlexObserver } from "#migration/native-plex/review.ts";
import type { NativePlexContext } from "#migration/native-plex/producer.ts";
import { nativePlexWireFixture } from "#migration/native-plex/test-fixture.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import {
  nativePlaybackFiles,
  type NativeCatalogScopeSnapshot,
} from "#shared/plex-binding/native-scope.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";

/** Synthetic HTTP catalog, derived from the actual reviewed physical group and canonical rows. */
export async function nativeReviewPlexFixture(
  original: NativeRecoveryObserverContext,
  scope: NativeCatalogScopeSnapshot,
) {
  if (
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "publication_compensation"
  )
    throw new Error(
      "Compensation fixtures must explicitly choose their catalog presentation",
    );
  const plexAccess = async (
    sectionType: "movie" | "show",
  ): Promise<PlexAccess> => {
    const sections = await original.permittedSections();
    const sectionId =
      sectionType === "movie" ? sections.movie : sections.series;
    assertConfiguredSection(sectionId);
    return {
      serverMachineId: original.expectedServerMachineId,
      sectionId,
      sectionType,
    };
  };
  const targets = await readNativePlexCanonicalTargets(original.db, scope);
  const kinds = [
    ...new Set(
      scope.files.map((file) =>
        file.libraryKind === "movies" ? ("movie" as const) : ("show" as const),
      ),
    ),
  ];
  const wire = nativePlexWireFixture({
    access: await Promise.all(kinds.map((kind) => plexAccess(kind))),
    groups: nativePlaybackFiles(scope).map((file) => ({
      canonicalPath: file.canonicalPath,
      sizeBytes: file.sizeBytes,
      targets: targets.filter((target) =>
        file.mediaIds.includes(target.scope.mediaId),
      ),
    })),
  });
  const context: NativePlexContext = {
    ...original,
    plex: wire.plex,
    plexAccess,
    describeWorkflow: () => Promise.resolve(null),
    qbittorrent: {
      login: () => Promise.resolve(),
      listAll: (...args) => original.qbittorrent.listAll(...args),
    },
  };
  return {
    context,
    wire,
    observe: (input: { planId: string; operationId: string }) =>
      createNativePlexObserver(context)(input, bindingTestExecution()),
  };
}

function assertConfiguredSection(sectionId: string | undefined) {
  if (sectionId === undefined)
    throw new Error("Native fixture configured section missing");
}
