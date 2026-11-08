import type { PlexEditionItem } from "#integrations/plex.ts";
import {
  PlexEditionSnapshotV1Schema,
  PlexEditionChangeV1Schema,
  type PlexEditionSnapshotV1,
} from "#shared/handoff/plex-edition.ts";
import {
  MovieEditionScopeSchema,
  MOVIE_EDITION_REGISTRY,
  type MovieEditionScope,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { exactPlexIdentity, type PlexCoverageInput } from "./plex.ts";
import { protectedEvidence } from "./context.ts";

/** A captured network fact supplies neither physical ownership nor metadata write authority. */
export function capturePlexEditionSnapshotV1(
  item: PlexEditionItem,
  input: {
    serverMachineId: string;
    sectionId: string;
    media: PlexCoverageInput["media"][number];
    canonicalPath: string;
    sizeBytes: string;
  },
): PlexEditionSnapshotV1 {
  const parts = item.Media?.flatMap((media) => media.Part) ?? [];
  const part = parts[0];
  if (
    !exactPlexIdentity(input.media, item) ||
    String(item.librarySectionID) !== input.sectionId
  )
    throw protectedEvidence("handoff_plex_identity_unproved");
  if (
    parts.length !== 1 ||
    part?.file !== input.canonicalPath ||
    (part.size !== undefined && String(part.size) !== input.sizeBytes)
  )
    throw protectedEvidence("handoff_plex_path_changed");
  const identity = {
    serverMachineId: input.serverMachineId,
    sectionId: input.sectionId,
    ratingKey: item.ratingKey,
    mediaId: input.media.id,
    partId: part.id,
    canonicalPath: part.file,
    sizeBytes: part.size === undefined ? null : String(part.size),
    title: item.title,
    year: item.year ?? null,
    guid: item.guid ?? null,
    guids: (item.Guid?.map((guid) => guid.id) ?? []).toSorted(),
  };
  const parsed = PlexEditionSnapshotV1Schema.safeParse({
    schemaVersion: 1,
    identity,
    identityHash: identityHash(identity),
    editionTitle: item.editionTitle ?? null,
    watch: {
      viewCount: item.viewCount ?? 0,
      lastViewedAt: item.lastViewedAt ?? null,
      viewOffset: item.viewOffset ?? null,
    },
  });
  if (!parsed.success) throw protectedEvidence("handoff_plex_metadata_invalid");
  return parsed.data;
}

export function planPlexEditionChangeV1(
  before: PlexEditionSnapshotV1,
  raw: MovieEditionScope,
  assetId: string,
) {
  const scope = MovieEditionScopeSchema.parse(raw);
  const targetEditionTitle = MOVIE_EDITION_REGISTRY[scope.edition].plexLabel;
  if (
    before.identity.mediaId !== scope.mediaId ||
    identityHash(before.identity) !== before.identityHash
  )
    throw protectedEvidence("handoff_plex_edit_scope_changed");
  if ((before.editionTitle ?? "") === targetEditionTitle) return null;
  return PlexEditionChangeV1Schema.parse({
    schemaVersion: 1,
    assetId,
    scope,
    identity: before.identity,
    identityHash: before.identityHash,
    beforeEditionTitle: before.editionTitle,
    targetEditionTitle,
  });
}

/** Watch observations may advance naturally; this operation must never erase them. */
export function assertPlexEditionReadbackV1(
  before: PlexEditionSnapshotV1,
  after: PlexEditionSnapshotV1,
  edition: MovieEditionKey,
): void {
  if (
    identityHash(before.identity) !== before.identityHash ||
    identityHash(after.identity) !== after.identityHash ||
    before.identityHash !== after.identityHash
  )
    throw protectedEvidence("handoff_plex_edit_identity_changed");
  if ((after.editionTitle ?? "") !== MOVIE_EDITION_REGISTRY[edition].plexLabel)
    throw protectedEvidence("handoff_plex_edit_label_unconfirmed");
  const original = before.watch;
  const current = after.watch;
  if (
    current.viewCount < original.viewCount ||
    (original.lastViewedAt !== null &&
      (current.lastViewedAt ?? -1) < original.lastViewedAt) ||
    (current.viewCount === original.viewCount &&
      original.viewOffset !== null &&
      (current.viewOffset ?? 0) < original.viewOffset)
  )
    throw protectedEvidence("handoff_plex_edit_watch_changed");
}
