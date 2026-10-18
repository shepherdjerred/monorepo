import { z } from "zod";
import type { Prisma, PlexIdentityMapping } from "#generated/prisma/client.ts";
import type { PlexServerAccess } from "#application/plex-access.ts";
import type { HandoffNetworkEvidenceSchema } from "#shared/handoff.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { LoadedHandoffPlan } from "./plan.ts";
import { protectedEvidence, type HandoffNetworkContext } from "./context.ts";

type ClaimEvidence = z.infer<typeof HandoffNetworkEvidenceSchema>["claims"];

export async function observeClaims(
  context: HandoffNetworkContext,
  input: LoadedHandoffPlan,
  signal: AbortSignal,
) {
  const evidence: ClaimEvidence = [];
  const sections = await context.permittedSections();
  for (const userId of [
    ...new Set(input.scope.claims.map((claim) => claim.userId)),
  ].sort()) {
    signal.throwIfAborted();
    const user = await context.db.mediaUser.findUniqueOrThrow({
      where: { id: userId },
      include: { plexIdentity: true, credentials: { where: { kind: "plex" } } },
    });
    const mapping = user.plexIdentity;
    const credential = user.credentials[0];
    if (
      !mapping ||
      !credential ||
      user.restricted ||
      mapping.plexRestricted ||
      mapping.kind !== "account" ||
      mapping.homeUserId !== null
    )
      throw protectedEvidence("handoff_claim_identity_unproved");
    const secret = z
      .object({ token: z.string().min(1) })
      .parse(
        JSON.parse(
          context.cipher.decrypt(
            credential.ciphertext,
            `plex:${user.plexAccountId}`,
          ),
        ),
      );
    const access = await context.authentication.resolveServerAccess(
      secret.token,
    );
    signal.throwIfAborted();
    if (
      access?.accountId !== user.plexAccountId ||
      access.serverMachineId !== context.expectedServerMachineId ||
      mapping.serverMachineId !== access.serverMachineId ||
      access.plexRestricted
    )
      throw protectedEvidence("handoff_claim_access_revoked");
    assertClaimLibraries({ input, userId, access, mapping, sections });
    const identity = {
      accountId: access.accountId,
      serverMachineId: access.serverMachineId,
      permittedSectionIds: [...access.permittedSectionIds].sort(),
      permittedMediaKinds: [...access.permittedMediaKinds].sort(),
    };
    evidence.push({
      userId,
      userVersion: user.version,
      mappingVersion: mapping.version,
      credentialId: credential.id,
      credentialUpdatedAt: credential.updatedAt.toISOString(),
      ...identity,
      identityHash: snapshotHash(identity),
    });
  }
  return evidence;
}

function assertClaimLibraries({
  input,
  userId,
  access,
  mapping,
  sections,
}: {
  input: LoadedHandoffPlan;
  userId: string;
  access: PlexServerAccess;
  mapping: PlexIdentityMapping;
  sections: { movie: string; series: string };
}) {
  for (const claim of input.scope.claims.filter(
    (item) => item.userId === userId,
  )) {
    const media = input.media.find((item) => item.id === claim.mediaId);
    if (!media) throw protectedEvidence("handoff_claim_media_missing");
    const kind = media.kind === "movie" ? "movie" : "series";
    if (
      !access.permittedMediaKinds.includes(kind) ||
      !access.permittedSectionIds.includes(sections[kind]) ||
      !mapping.permittedMediaKinds.includes(kind) ||
      !mapping.permittedSectionIds.includes(sections[kind])
    )
      throw protectedEvidence("handoff_claim_library_denied");
  }
}

export async function assertClaimsCurrent(
  db: Prisma.TransactionClient,
  claims: ClaimEvidence,
) {
  for (const claim of claims) {
    await db.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${claim.userId} FOR SHARE`;
    await db.$queryRaw`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" = ${claim.userId} FOR SHARE`;
    await db.$queryRaw`SELECT id FROM "Credential" WHERE id = ${claim.credentialId} FOR SHARE`;
    const user = await db.mediaUser.findUniqueOrThrow({
      where: { id: claim.userId },
      include: { plexIdentity: true },
    });
    const credential = await db.credential.findUnique({
      where: { id: claim.credentialId },
    });
    if (
      user.version !== claim.userVersion ||
      user.plexIdentity?.version !== claim.mappingVersion ||
      credential?.updatedAt.toISOString() !== claim.credentialUpdatedAt
    )
      throw protectedEvidence("handoff_claim_changed");
  }
}
