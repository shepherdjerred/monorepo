import type {
  MediaUser,
  PlexIdentityMapping,
} from "#generated/prisma/client.ts";
import type { RecoveryScope } from "#shared/recovery.ts";
import { isRecoveryScopeV2, respondentMediaIds } from "#shared/recovery.ts";

/** The household snapshot is owner-only; members see only their currently accessible titles. */
export function recoveryView(
  scope: RecoveryScope,
  user: MediaUser & { plexIdentity: PlexIdentityMapping | null },
  machineId: string,
): RecoveryScope {
  if (user.role === "owner" && !user.restricted) return scope;
  const mapping = user.plexIdentity;
  const permitted =
    scope.users.some((item) => item.id === user.id) &&
    mapping !== null &&
    !user.restricted &&
    mapping.kind === "account" &&
    mapping.serverMachineId === machineId &&
    !mapping.plexRestricted &&
    mapping.verifiedAt !== null &&
    mapping.verifiedAt >= new Date(Date.now() - 300_000) &&
    mapping.verifiedAt <= new Date();
  const applicable = respondentMediaIds(scope, user.id);
  const media = scope.media.filter(
    (item) =>
      permitted &&
      applicable.includes(item.id) &&
      item.sectionId !== null &&
      mapping.permittedSectionIds.includes(item.sectionId) &&
      mapping.permittedMediaKinds.includes(
        item.kind === "movie" ? "movie" : "series",
      ),
  );
  const redacted = {
    ...scope,
    media,
    users: scope.users.filter((item) => item.id === user.id),
    excludedUsers: [],
    holds: [],
    assets: [],
    requests: [],
    coverage: [],
    personalHolds: [],
    handoffReceipts: [],
    nativeReceipts: [],
    blockers:
      media.length === applicable.length
        ? []
        : ["review_includes_unavailable_media"],
  };
  if (!isRecoveryScopeV2(scope)) return redacted;
  const visibleIds = new Set(media.map((item) => item.id));
  return {
    ...redacted,
    schemaVersion: 2,
    householdRoster: [],
    excludedPairs: [],
    legacyClaims: [],
    users: scope.users
      .filter((item) => item.id === user.id)
      .map((item) => ({
        ...item,
        applicableMediaIds: item.applicableMediaIds.filter((id) =>
          visibleIds.has(id),
        ),
        claimAcknowledgements: item.claimAcknowledgements.filter((claim) =>
          claim.mediaIds.every((id) => visibleIds.has(id)),
        ),
      })),
  };
}
