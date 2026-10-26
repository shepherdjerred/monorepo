import { readNativePlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import type { NativeCompensationObserverContext } from "#migration/native-compensation/evidence.ts";
import type { NativePlexContext } from "#migration/native-plex/producer.ts";
import { nativePlexWireFixture } from "#migration/native-plex/test-fixture.ts";
import type { NativeCompensationScope } from "#shared/native-recovery/compensation.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";

/** Explicit stale predecessor catalog. Physical journals/hashes alone decide which bytes exist. */
export async function compensationNativePlexFixture(
  original: NativeCompensationObserverContext,
  scope: NativeCompensationScope,
) {
  const plexAccess = async (
    sectionType: "movie" | "show",
  ): Promise<PlexAccess> => {
    const sections = await original.permittedSections();
    return {
      serverMachineId: original.expectedServerMachineId,
      sectionId: sectionType === "movie" ? sections.movie : sections.series,
      sectionType,
    };
  };
  const targets = await readNativePlexCanonicalTargets(original.db, scope);
  const kinds = [
    ...new Set(
      scope.entries.map((value) =>
        value.entry.libraryKind === "movies"
          ? ("movie" as const)
          : ("show" as const),
      ),
    ),
  ];
  const wire = nativePlexWireFixture({
    access: await Promise.all(kinds.map((kind) => plexAccess(kind))),
    groups: scope.entries.map((value) => {
      const predecessor = value.predecessor;
      if (predecessor === null)
        throw new Error("Actual compensation predecessor missing");
      const file = scope.files.find(
        (candidate) => candidate.assetId === predecessor.id,
      );
      if (file?.canonicalPath !== predecessor.path)
        throw new Error(
          "Actual compensation canonical predecessor differs from its reviewed descriptor",
        );
      return {
        canonicalPath: file.canonicalPath,
        sizeBytes: predecessor.sizeBytes,
        targets: targets.filter((target) =>
          value.entry.mediaIds.includes(target.scope.mediaId),
        ),
      };
    }),
  });
  const context: NativePlexContext = {
    ...original,
    plex: wire.plex,
    plexAccess,
    qbittorrent: {
      login: () => Promise.resolve(),
      listAll: (...args) => original.qbittorrent.listAll(...args),
    },
  };
  return { context, wire };
}
