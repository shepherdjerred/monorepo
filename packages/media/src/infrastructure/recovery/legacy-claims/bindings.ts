import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import {
  LegacyIdentitySchema,
  LegacyRequesterBindingSchema,
} from "#shared/recovery-claims.ts";
import { MigrationRecordSchema } from "#shared/migration.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { advanceLegacyClaimKnowledge } from "./knowledge-fence.ts";

/** Caller locks users/mappings first. Capture ingestion also takes this lock. */
export async function lockLegacyRequesterBindings(
  db: Prisma.TransactionClient,
) {
  await advanceLegacyClaimKnowledge(db);
}
export function claimConflict(message: string) {
  return new MediaError("legacy_requester_binding_changed", message, 409);
}
export async function lockBindingUsers(
  db: Prisma.TransactionClient,
  ids: string[],
) {
  const sorted = [...new Set(ids)].sort();
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR SHARE`,
  );
  await db.$queryRaw(
    Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(sorted)}) ORDER BY "userId" FOR SHARE`,
  );
}
export function bindingIdentity(
  user: Prisma.MediaUserGetPayload<{ include: { plexIdentity: true } }>,
) {
  const mapping = user.plexIdentity;
  if (mapping === null)
    throw claimConflict(
      "The selected person must establish a verified Plex identity first",
    );
  return LegacyIdentitySchema.parse({
    userId: user.id,
    userVersion: user.version,
    plexAccountId: user.plexAccountId,
    kind: mapping.kind,
    version: mapping.version,
    serverMachineId: mapping.serverMachineId,
    serverAccountId: mapping.serverAccountId,
    homeUserId: mapping.homeUserId,
    permittedSectionIds: [...mapping.permittedSectionIds].sort(),
    permittedMediaKinds: [...mapping.permittedMediaKinds].sort(),
    restricted: user.restricted,
    plexRestricted: mapping.plexRestricted,
  });
}
/** Refresh timestamps/scopes/versions are authority for a review, not a new historical person. */
export function durableBindingIdentity(value: unknown) {
  const identity = LegacyIdentitySchema.parse(value);
  return {
    userId: identity.userId,
    plexAccountId: identity.plexAccountId,
    kind: identity.kind,
    serverMachineId: identity.serverMachineId,
    serverAccountId: identity.serverAccountId,
    homeUserId: identity.homeUserId,
  };
}
export function eligibleBindingTarget(
  user: Prisma.MediaUserGetPayload<{ include: { plexIdentity: true } }>,
  machineId: string,
) {
  const mapping = user.plexIdentity;
  if (
    user.restricted ||
    mapping?.serverMachineId !== machineId ||
    mapping.verifiedAt === null ||
    mapping.verifiedAt.getTime() > Date.now() ||
    Date.now() - mapping.verifiedAt.getTime() > 300_000 ||
    mapping.serverAccountId === null
  )
    return false;
  return mapping.kind === "account"
    ? mapping.homeUserId === null &&
        /^\d+$/u.test(user.plexAccountId) &&
        !mapping.plexRestricted
    : mapping.kind === "managed" && mapping.homeUserId !== null;
}
export function bindingView(
  row: Prisma.LegacyRequesterBindingGetPayload<object>,
) {
  return LegacyRequesterBindingSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    provenance: "owner_declared_identity_only",
  });
}
export async function requesterEvidence(
  db: Prisma.TransactionClient,
  captureId: string,
  requesterSourceId: string,
) {
  const capture = await db.migrationCapture.findUnique({
    where: { id: captureId },
  });
  if (capture === null)
    throw claimConflict("The exact source capture is unavailable");
  const records = await db.migrationRecord.findMany({
    where: {
      captureId,
      kind: "request",
      payload: { path: ["requesterSourceId"], equals: requesterSourceId },
    },
    orderBy: { provenanceKey: "asc" },
    take: 1001,
  });
  if (records.length > 1000)
    throw claimConflict(
      "Capture requester evidence exceeds the supported 1000-record bound",
    );
  const selected = records.filter((row) => {
    const record = MigrationRecordSchema.parse(row.payload);
    return (
      record.kind === "request" &&
      record.requesterSourceId === requesterSourceId
    );
  });
  if (selected.length === 0)
    throw claimConflict("Requester is absent from this exact capture");
  for (const row of selected)
    if (snapshotHash(z.json().parse(row.payload)) !== row.observationHash)
      throw claimConflict("Stored requester record digest changed");
  const requesterEvidenceHash = snapshotHash({
    captureHash: capture.manifestHash,
    requesterSourceId,
    records: selected.map((row) => ({
      provenanceKey: row.provenanceKey,
      recordDigest: row.observationHash,
    })),
  });
  return { capture, requesterEvidenceHash, requestCount: selected.length };
}
