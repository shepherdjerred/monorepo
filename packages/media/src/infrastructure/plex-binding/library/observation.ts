import type {
  LibraryPlexReceiptV1,
  LibraryPlexExpectedV2,
} from "#shared/plex-binding/library.ts";
import { plexScopeKey } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** A complete verifier result must exactly describe the captured physical and canonical owner. */
export function assertLibraryPlexObservation(
  expected: LibraryPlexExpectedV2,
  observation: LibraryPlexReceiptV1["observation"],
  expiresAtMs: number,
) {
  const associations = observation.associations;
  const scopes = associations.map((association) =>
    plexScopeKey(association.scope),
  );
  const targets = new Map(
    expected.targets.map((target) => [plexScopeKey(target.scope), target]),
  );
  if (
    identityHash(scopes) !==
      identityHash(
        expected.newGroups[0].coverage.map((scope) => plexScopeKey(scope)),
      ) ||
    Date.parse(observation.verification.expiresAt) > expiresAtMs ||
    observation.verification.passes.some(
      (pass) => pass.selectedHash !== identityHash(associations),
    )
  )
    throw new Error(
      "Library Plex observation lost complete physical coverage or its deadline",
    );
  for (const association of associations) {
    const target = targets.get(plexScopeKey(association.scope));
    if (
      target === undefined ||
      identityHash(association.group) !== identityHash(expected.newGroups[0]) ||
      association.editionRootId !== target.editionRootId ||
      association.canonicalIdentityHash !== target.canonicalIdentityHash ||
      association.numberingHash !== target.numberingHash ||
      identityHash(association.definition) !==
        identityHash(target.definition) ||
      identityHash([association.access]) !== identityHash(expected.access)
    )
      throw new Error(
        "Library Plex observation differs from captured authority",
      );
  }
  return associations;
}
