import type {
  LegacyRequesterBinding,
  Prisma,
} from "#generated/prisma/client.ts";
import {
  bindingIdentity,
  durableBindingIdentity,
  requesterEvidence,
} from "#infrastructure/recovery/legacy-claims/bindings.ts";
import { snapshotHash } from "#migration/profile-import.ts";

type PlexUser = Prisma.MediaUserGetPayload<{ include: { plexIdentity: true } }>;
type Capture = Pick<
  Prisma.MigrationCaptureGetPayload<object>,
  "id" | "sourceKind" | "sourceInstanceId" | "manifestHash"
>;

export function isIndependentSeerrAccount(user: PlexUser) {
  const mapping = user.plexIdentity;
  return (
    !user.restricted &&
    /^[1-9]\d*$/u.test(user.plexAccountId) &&
    mapping?.kind === "account" &&
    mapping.homeUserId === null &&
    !mapping.plexRestricted
  );
}

/** Match the entire captured requester to one globally unique Plex account. */
export async function captureHasUniquePlexRequester(
  tx: Prisma.TransactionClient,
  input: {
    captureId: string;
    requesterSourceId: string;
    plexAccountId: string;
    requestCount?: number;
  },
) {
  const { captureId, requesterSourceId, plexAccountId, requestCount } = input;
  const scope = { captureId, kind: "request" };
  const requester = {
    payload: { path: ["requesterSourceId"], equals: requesterSourceId },
  };
  const account = {
    payload: { path: ["plexAccountId"], equals: plexAccountId },
  };
  const [matching, accountRows, requesterRows] = await Promise.all([
    tx.migrationRecord.count({
      where: { ...scope, AND: [requester, account] },
    }),
    tx.migrationRecord.count({ where: { ...scope, ...account } }),
    requestCount ??
      tx.migrationRecord.count({ where: { ...scope, ...requester } }),
  ]);
  return matching > 0 && matching === accountRows && matching === requesterRows;
}

/** The caller locks the verified user and requester knowledge before attaching. */
export async function ensureSeerrAttachmentBinding(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    user: PlexUser;
    capture: Capture;
    requesterSourceId: string;
  },
): Promise<LegacyRequesterBinding | null> {
  const { actorId, user, capture, requesterSourceId } = input;
  const { sourceKind, sourceInstanceId } = capture;
  if (
    !isIndependentSeerrAccount(user) ||
    !["seerr", "overseerr", "jellyseerr"].includes(sourceKind)
  )
    return null;

  const evidence = await requesterEvidence(tx, capture.id, requesterSourceId);
  if (
    !evidence.capture.complete ||
    !evidence.capture.stable ||
    evidence.capture.manifestHash !== capture.manifestHash ||
    evidence.capture.sourceKind !== sourceKind ||
    evidence.capture.sourceInstanceId !== sourceInstanceId
  )
    return null;

  if (
    !(await captureHasUniquePlexRequester(tx, {
      captureId: capture.id,
      requesterSourceId,
      plexAccountId: user.plexAccountId,
      requestCount: evidence.requestCount,
    }))
  )
    return null;

  const scope = { sourceKind, sourceInstanceId, requesterSourceId };
  const latest = await tx.legacyRequesterBinding.findFirst({
    where: scope,
    orderBy: { revision: "desc" },
  });
  const identity = bindingIdentity(user);
  if (latest !== null) {
    if (
      latest.userId !== user.id ||
      snapshotHash(durableBindingIdentity(latest.identitySnapshot)) !==
        snapshotHash(durableBindingIdentity(identity))
    )
      return null;
    if (latest.captureId === capture.id)
      return latest.captureHash === capture.manifestHash &&
        latest.requesterEvidenceHash === evidence.requesterEvidenceHash
        ? latest
        : null;
  }

  return tx.legacyRequesterBinding.create({
    data: {
      ...scope,
      captureId: capture.id,
      captureHash: capture.manifestHash,
      requesterEvidenceHash: evidence.requesterEvidenceHash,
      actorId,
      userId: user.id,
      identitySnapshot: identity,
      revision: (latest?.revision ?? 0) + 1,
      previousId: latest?.id ?? null,
    },
  });
}
