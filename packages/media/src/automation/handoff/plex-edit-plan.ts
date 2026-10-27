import type { HandoffProtocolScope } from "#shared/handoff/protocol.ts";
import {
  HandoffNetworkV3Schema,
  StableHandoffNetworkV3Schema,
} from "#shared/handoff/library-v3.ts";
import { planPlexEditionChangeV1 } from "#migration/handoff-network/plex-edition.ts";
import { MOVIE_EDITION_REGISTRY } from "#shared/movie-editions/registry.ts";

export function handoffPlexEditionChanges(
  scope: HandoffProtocolScope,
  raw: unknown,
) {
  if (!("schemaVersion" in scope) || scope.schemaVersion !== 3) return {};
  const network = HandoffNetworkV3Schema.parse(raw);
  const plexEdits = [];
  for (const file of scope.files.filter(
    (item) => item.libraryKind === "movies",
  )) {
    const association = network.plex.find(
      (item) => item.assetId === file.assetId,
    );
    const before = association?.movieEdition;
    const mediaId = file.mediaIds[0];
    if (
      before == null ||
      mediaId === undefined ||
      association?.edition !== file.edition ||
      before.identity.canonicalPath !== file.canonicalPath
    )
      throw new Error(
        "Library edition edit has no exact original movie observation",
      );
    const change = planPlexEditionChangeV1(
      before,
      { rootMediaId: mediaId, mediaId, edition: file.edition },
      file.assetId,
    );
    if (change !== null) plexEdits.push(change);
  }
  return {
    plexEdits: plexEdits.toSorted((a, b) => a.assetId.localeCompare(b.assetId)),
  };
}

/** This new v3 projection excludes only the editable label, never an older stored hash. */
export function handoffPlexIdentityV3(raw: unknown) {
  const network = StableHandoffNetworkV3Schema.parse(raw);
  return {
    ...network,
    plex: network.plex.map(({ editionTitle: _label, ...identity }) => identity),
  };
}

export function assertHandoffPlexLabelsV3(raw: unknown): void {
  const network = StableHandoffNetworkV3Schema.parse(raw);
  for (const item of network.plex) {
    if (item.movieEdition === null) continue;
    if (
      (item.editionTitle ?? "") !==
      MOVIE_EDITION_REGISTRY[item.edition].plexLabel
    )
      throw new Error(
        "Library edition correction has not reached its registered target label",
      );
  }
}
