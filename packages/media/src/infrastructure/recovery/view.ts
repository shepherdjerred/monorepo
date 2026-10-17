import type {
  MediaUser,
  PlexIdentityMapping,
} from "#generated/prisma/client.ts";
import type { RecoveryScope } from "#shared/recovery.ts";

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
    mapping.kind === "account" &&
    mapping.serverMachineId === machineId &&
    !mapping.plexRestricted &&
    mapping.verifiedAt !== null &&
    mapping.verifiedAt >= new Date(Date.now() - 300_000) &&
    mapping.verifiedAt <= new Date();
  const media = scope.media.filter(
    (item) =>
      permitted &&
      item.sectionId !== null &&
      mapping.permittedSectionIds.includes(item.sectionId) &&
      mapping.permittedMediaKinds.includes(
        item.kind === "movie" ? "movie" : "series",
      ),
  );
  return {
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
      media.length === scope.media.length
        ? []
        : ["review_includes_unavailable_media"],
  };
}
