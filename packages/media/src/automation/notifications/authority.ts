import type { Prisma } from "#generated/prisma/client.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  AuthorityRevocationSchema,
  OwnerHealthSchema,
  VerificationAuthoritySchema,
  ownerHealthKey,
} from "#shared/notification-authority.ts";
import type { Delivery } from "./message.ts";
import type { z } from "zod";

/** Caller holds runtime → recipient/preferences → delivery locks through the effect. */
export async function deliveryAuthority(
  tx: Prisma.TransactionClient,
  delivery: Delivery,
): Promise<string | null> {
  if (delivery.event.kind === "owner_health")
    return ownerHealthAuthority(tx, delivery);
  if (delivery.event.kind === "email_verification")
    return verificationAuthority(tx, delivery);
  return (await lockRuntimeAuthority(tx, delivery.recoveryEpoch))
    ? null
    : "notification_runtime_protected";
}

async function ownerHealthAuthority(
  tx: Prisma.TransactionClient,
  delivery: Delivery,
): Promise<string | null> {
  const payload = OwnerHealthSchema.safeParse(delivery.event.payload);
  if (
    !payload.success ||
    delivery.event.mediaId !== null ||
    delivery.event.actorId !== null ||
    delivery.event.dedupeKey !== ownerHealthKey(payload.data)
  )
    return "owner_health_evidence_invalid";
  const proof = payload.data;
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    runtime.recoveryEpoch !== delivery.recoveryEpoch ||
    proof.recoveryEpoch !== runtime.recoveryEpoch ||
    proof.runtimeVersion !== runtime.version ||
    runtime.mode !== "observe" ||
    runtime.ownershipConfirmed
  )
    return "owner_health_superseded";
  if (
    delivery.user.role !== "owner" ||
    delivery.user.restricted ||
    !["email", "discord"].includes(delivery.channel)
  )
    return "owner_health_recipient_protected";
  return (await trustedRevocation(tx, proof))
    ? null
    : "owner_health_evidence_invalid";
}

async function trustedRevocation(
  tx: Prisma.TransactionClient,
  proof: z.infer<typeof OwnerHealthSchema>,
): Promise<boolean> {
  const source = await tx.applicationEvent.findUnique({
    where: { id: proof.sourceEventId },
  });
  const sourceProof = AuthorityRevocationSchema.safeParse(source?.payload);
  return (
    sourceProof.success &&
    source?.kind === proof.reason &&
    source.actorId === null &&
    source.mediaId === null &&
    source.dedupeKey === `${ownerHealthKey(proof)}:source` &&
    sourceProof.data.recoveryEpoch === proof.recoveryEpoch &&
    sourceProof.data.runtimeVersion === proof.runtimeVersion &&
    sourceProof.data.reason === proof.reason &&
    sourceProof.data.evidenceDigest === proof.evidenceDigest
  );
}

async function verificationAuthority(
  tx: Prisma.TransactionClient,
  delivery: Delivery,
): Promise<string | null> {
  const payload = VerificationAuthoritySchema.safeParse(delivery.event.payload);
  if (
    !payload.success ||
    delivery.channel !== "email" ||
    delivery.event.mediaId !== null ||
    delivery.event.actorId !== delivery.userId ||
    payload.data.requesterId !== delivery.userId ||
    delivery.user.restricted
  )
    return "email_verification_protected";
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    runtime.recoveryEpoch !== delivery.recoveryEpoch ||
    payload.data.recoveryEpoch !== runtime.recoveryEpoch
  )
    return "email_verification_superseded";
  const record = await tx.emailVerification.findUnique({
    where: { id: payload.data.verificationId },
  });
  return record?.userId === delivery.userId && record.expiresAt > new Date()
    ? null
    : "email_verification_superseded";
}
