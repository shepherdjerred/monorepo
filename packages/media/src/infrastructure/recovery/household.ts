import { z } from "zod";
import type {
  MediaItem,
  MediaUser,
  PlexIdentityMapping,
} from "#generated/prisma/client.ts";
import type { RecoveryScope } from "#shared/recovery.ts";
type HouseholdUser = MediaUser & { plexIdentity: PlexIdentityMapping | null };
type ReviewedMedia = RecoveryScope["media"][number];

/** A fresh exact denial can exclude an unrelated person; missing evidence cannot. */
export function hasProvenNoRecoveryAccess(input: {
  user: MediaUser & { plexIdentity: PlexIdentityMapping | null };
  media: MediaItem[];
  relevantUserIds: Set<string>;
  machineId: string;
}) {
  const { user, media, relevantUserIds, machineId } = input;
  if (relevantUserIds.has(user.id)) return false;
  const mapping = user.plexIdentity;
  if (
    mapping?.serverMachineId !== machineId ||
    mapping.verifiedAt === null ||
    mapping.verifiedAt < new Date(Date.now() - 300_000) ||
    mapping.verifiedAt > new Date()
  )
    return false;
  return media.every((item) => {
    const section = z
      .object({ plexSectionId: z.string().optional() })
      .parse(item.externalIds).plexSectionId;
    if (section === undefined) return false;
    return (
      !mapping.permittedSectionIds.includes(section) ||
      !mapping.permittedMediaKinds.includes(
        item.kind === "movie" ? "movie" : "series",
      )
    );
  });
}

/** Required declarations are per title; absent or stale authority never implies denial. */
export function recoveryHouseholdPairs(input: {
  users: (MediaUser & { plexIdentity: PlexIdentityMapping | null })[];
  scope: RecoveryScope;
  machineId: string;
  ancestorsByMedia: Record<string, string[]>;
  relevantClaims: { userId: string; mediaIds: string[] }[];
}) {
  const requests = z
    .array(z.object({ userId: z.string(), mediaId: z.string() }))
    .parse(input.scope.requests);
  const holds = z
    .array(z.object({ userId: z.string(), mediaId: z.string() }))
    .parse(input.scope.personalHolds);
  const excluded: {
    userId: string;
    mediaId: string;
    reason: "fresh_scope_denial_without_relevant_claim";
  }[] = [];
  const blockers: string[] = [];
  const roster = input.users.map((user) => {
    const applicableMediaIds: string[] = [];
    for (const media of input.scope.media) {
      const related = new Set([
        media.id,
        ...(input.ancestorsByMedia[media.id] ?? []),
      ]);
      const historical =
        [...requests, ...holds].some(
          (claim) => claim.userId === user.id && related.has(claim.mediaId),
        ) ||
        input.relevantClaims.some(
          (claim) =>
            claim.userId === user.id && claim.mediaIds.includes(media.id),
        );
      const { known, accessible } = currentPairAccess(
        user.plexIdentity,
        media,
        input.machineId,
      );
      const identity = knownIdentity(user.plexIdentity);
      if (known && !accessible && !historical && identity) {
        excluded.push({
          userId: user.id,
          mediaId: media.id,
          reason: "fresh_scope_denial_without_relevant_claim",
        });
        continue;
      }
      applicableMediaIds.push(media.id);
      if (!known || !identity || user.restricted)
        blockers.push("household_identity_requires_reconciliation");
      else if (!accessible) blockers.push("historical_claim_access_revoked");
    }
    return subjectSnapshot(user, applicableMediaIds);
  });
  return { roster, excluded, blockers };
}

function subjectSnapshot(user: HouseholdUser, applicableMediaIds: string[]) {
  const mapping = user.plexIdentity;
  return {
    id: user.id,
    displayName: user.displayName,
    plexAccountId: user.plexAccountId,
    version: user.version,
    role: user.role,
    restricted: user.restricted,
    mappingVersion: mapping?.version ?? null,
    mappingKind: mapping?.kind ?? null,
    serverMachineId: mapping?.serverMachineId ?? null,
    homeUserId: mapping?.homeUserId ?? null,
    serverAccountId: mapping?.serverAccountId ?? null,
    permittedSectionIds: mapping?.permittedSectionIds ?? [],
    permittedMediaKinds: mapping?.permittedMediaKinds ?? [],
    plexRestricted: mapping?.plexRestricted ?? true,
    declarationAuthority:
      mapping?.kind === "managed"
        ? ("managed_owner" as const)
        : ("self" as const),
    applicableMediaIds,
  };
}

function knownIdentity(mapping: PlexIdentityMapping | null) {
  if (mapping === null) return false;
  return mapping.kind === "managed"
    ? mapping.homeUserId !== null
    : mapping.kind === "account" &&
        mapping.homeUserId === null &&
        !mapping.plexRestricted;
}

function currentPairAccess(
  mapping: PlexIdentityMapping | null,
  media: ReviewedMedia,
  machineId: string,
) {
  if (
    mapping?.serverMachineId !== machineId ||
    mapping.verifiedAt === null ||
    mapping.verifiedAt.getTime() > Date.now() ||
    mapping.verifiedAt.getTime() < Date.now() - 300_000 ||
    media.sectionId === null
  )
    return { known: false, accessible: false };
  return {
    known: true,
    accessible:
      mapping.permittedSectionIds.includes(media.sectionId) &&
      mapping.permittedMediaKinds.includes(
        media.kind === "movie" ? "movie" : "series",
      ),
  };
}
