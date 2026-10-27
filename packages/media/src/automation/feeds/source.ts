import type { Prisma } from "#generated/prisma/client.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";
import { candidateSourceIdentity } from "#automation/candidate-evidence.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { FeedSourceV1Schema } from "#shared/feeds/contract.ts";
import { queueOperation } from "#automation/store.ts";

/** Immutable observations are separate from a target-specific release interpretation or acquisition. */
export async function retainFeedSourceV1(
  tx: Prisma.TransactionClient,
  cipher: CredentialCipher,
  source: ProviderCandidate,
) {
  const fingerprint = identityHash(candidateSourceIdentity(source));
  const key = `feed-source-v1:${source.providerId}:${fingerprint}`;
  const payload = FeedSourceV1Schema.parse({
    schemaVersion: 1,
    providerId: source.providerId,
    providerReleaseId: source.providerReleaseId,
    identityHash: fingerprint,
    sourceHash: identityHash(nativeJson(source)),
    encryptedSource: cipher.encrypt(JSON.stringify(source), key),
  });
  const event = await tx.applicationEvent.upsert({
    where: { dedupeKey: key },
    update: {},
    create: { dedupeKey: key, kind: "provider_feed_source_v1", payload },
  });
  const stored = FeedSourceV1Schema.parse(event.payload);
  if (
    stored.providerId !== source.providerId ||
    stored.identityHash !== fingerprint ||
    stored.providerReleaseId !== source.providerReleaseId
  )
    throw new Error("Provider feed source identity changed");
  await queueOperation(tx, {
    key: `match-feed-source-v1:${event.id}`,
    kind: "match_provider_feed_source_v1",
    targetId: event.id,
    payload: { schemaVersion: 1, sourceId: event.id, cursor: null },
  });
  return { id: event.id, identityHash: fingerprint };
}

export async function readFeedSourceV1(
  tx: Prisma.TransactionClient,
  cipher: CredentialCipher,
  id: string,
) {
  const event = await tx.applicationEvent.findUniqueOrThrow({ where: { id } });
  const stored = FeedSourceV1Schema.parse(event.payload);
  if (
    event.kind !== "provider_feed_source_v1" ||
    event.mediaId !== null ||
    event.actorId !== null ||
    event.dedupeKey !==
      `feed-source-v1:${stored.providerId}:${stored.identityHash}`
  )
    throw new Error("Provider feed observation lost its original source");
  const raw: unknown = JSON.parse(
    cipher.decrypt(stored.encryptedSource, event.dedupeKey),
  );
  if (identityHash(raw) !== stored.sourceHash)
    throw new Error("Provider feed snapshot hash changed");
  const source = StoredCandidateSchema.parse(raw);
  if (
    source.providerId !== stored.providerId ||
    source.providerReleaseId !== stored.providerReleaseId ||
    identityHash(candidateSourceIdentity(source)) !== stored.identityHash
  )
    throw new Error("Provider feed snapshot identity changed");
  return source;
}
