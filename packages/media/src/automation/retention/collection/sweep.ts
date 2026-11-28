import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  lockRuntimeAuthority,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { PlexCollectionTarget } from "#integrations/plex-collections/contract.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import { desiredCollectionMembers } from "./decision.ts";
import {
  CollectionMembershipSchema,
  nextCollectionChange,
  type CollectionMembership,
} from "./membership.ts";
import { retiredWriterExpiry } from "./writer-proof.ts";
import {
  recordCollectionAttempt,
  runCollectionAttempt,
  unresolvedMembers,
} from "./attempt.ts";

// The two static Plex collections reviewed during the Maintainerr inventory.
const COLLECTIONS = [
  {
    ratingKey: "2909",
    sectionId: "1",
    sectionType: "movie",
    title: "Movies going away",
  },
  {
    ratingKey: "5367",
    sectionId: "2",
    sectionType: "show",
    title: "Shows going away",
  },
] as const satisfies readonly PlexCollectionTarget[];
const CHECKPOINT_KIND = "plex_leaving_soon_membership";
const Checkpoint = z.strictObject({
  collectionGuid: z.string().min(1).max(2048),
  owned: z.array(CollectionMembershipSchema).max(1000),
});
type CollectionScope = {
  target: PlexCollectionTarget;
  access: PlexAccess;
  epoch: number;
  signal: AbortSignal;
};

async function retiredWritersUntil(
  tx: Prisma.TransactionClient,
  epoch: number,
) {
  if (!(await lockRuntimeAuthority(tx, epoch))) return null;
  const lease = await tx.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  return retiredWriterExpiry(lease, epoch, Date.now());
}

async function sweepCollection(
  context: MediaAutomationContext,
  scope: CollectionScope,
) {
  const { target, access, epoch, signal } = scope;
  if (
    access.sectionId !== target.sectionId ||
    access.sectionType !== target.sectionType
  )
    return;
  const serverMachineId = access.serverMachineId;
  const dedupeKey = `plex-leaving-soon:${serverMachineId}:${target.sectionId}:${target.ratingKey}`;
  await context.db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${dedupeKey}, 0)) AS locked
    `;
      if (locked[0]?.locked !== true) return;
      const expires = await retiredWritersUntil(tx, epoch);
      if (expires === null) return;
      const active = AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.max(0, expires - Date.now())),
      ]);
      if (!active.aborted)
        await projectCollection(
          context,
          tx,
          { ...scope, signal: active },
          dedupeKey,
        );
    },
    { timeout: 10_000 },
  );
}

async function projectCollection(
  context: MediaAutomationContext,
  tx: Prisma.TransactionClient,
  scope: CollectionScope,
  dedupeKey: string,
) {
  const { plex } = context;
  const { target, access, epoch, signal } = scope;
  const desired = await desiredCollectionMembers(tx, access, epoch);
  if (desired === null) return;
  const row = await tx.applicationEvent.findUnique({ where: { dedupeKey } });
  if (row !== null && row.kind !== CHECKPOINT_KIND)
    throw new Error("Plex collection checkpoint key belongs to another event");
  const stored = row === null ? null : Checkpoint.parse(row.payload);
  const previous = stored?.owned ?? [];
  if (desired.length === 0 && previous.length === 0) return;
  if ((await plex.machineIdentifier(signal)) !== access.serverMachineId)
    throw new IntegrationError("plex", "unsupported-target");
  const collection = await plex.collection(target, signal);
  if (stored !== null && stored.collectionGuid !== collection.guid)
    throw new IntegrationError("plex", "conflict");
  const protectedKeys = await unresolvedMembers(tx, dedupeKey, collection.guid);
  if (protectedKeys === null) return;
  const owned = previous.filter(({ ratingKey }) =>
    collection.memberKeys.has(ratingKey),
  );
  const change = nextCollectionChange(
    desired,
    owned,
    collection.memberKeys,
    protectedKeys,
  );
  if (change !== null) {
    await applyMembership(context, tx, scope, {
      change,
      owned,
      collectionGuid: collection.guid,
      dedupeKey,
    });
  } else if (owned.length !== previous.length) {
    await saveMembership(tx, dedupeKey, collection.guid, owned);
  }
}

async function saveMembership(
  tx: Prisma.TransactionClient,
  dedupeKey: string,
  collectionGuid: string,
  owned: readonly CollectionMembership[],
) {
  const payload = Checkpoint.parse({ collectionGuid, owned });
  await tx.applicationEvent.upsert({
    where: { dedupeKey },
    create: { dedupeKey, kind: CHECKPOINT_KIND, payload },
    update: { payload },
  });
}

async function applyMembership(
  { db, plex }: MediaAutomationContext,
  tx: Prisma.TransactionClient,
  { target, access, signal }: CollectionScope,
  input: {
    change: NonNullable<ReturnType<typeof nextCollectionChange>>;
    owned: readonly CollectionMembership[];
    collectionGuid: string;
    dedupeKey: string;
  },
) {
  const { item, present } = input.change;
  const live = await plex.collectionMember(item.ratingKey, signal);
  if (
    live.item.type !== access.sectionType ||
    live.item.guid !== item.guid ||
    String(live.sectionId) !== access.sectionId
  )
    throw new IntegrationError("plex", "conflict");
  const runtime = await runtimeAuthority(tx);
  if (!runtime.active || signal.aborted) return;
  await runCollectionAttempt({
    record: () =>
      recordCollectionAttempt(db, input.dedupeKey, {
        collectionGuid: input.collectionGuid,
        collectionTitle: target.title,
        member: item,
        present,
      }),
    applyAndVerify: async () => {
      await plex.setCollectionMembership(
        {
          serverMachineId: access.serverMachineId,
          collection: target.ratingKey,
          member: item.ratingKey,
          present,
        },
        signal,
      );
      const verified = await plex.collection(target, signal);
      if (
        verified.guid !== input.collectionGuid ||
        verified.memberKeys.has(item.ratingKey) !== present
      )
        throw new IntegrationError("plex", "conflict");
    },
    acknowledge: async (operationId) => {
      const owned = present
        ? [...input.owned, item]
        : input.owned.filter(
            (existing) => existing.ratingKey !== item.ratingKey,
          );
      await saveMembership(tx, input.dedupeKey, input.collectionGuid, owned);
      await tx.operation.update({
        where: { id: operationId },
        data: { status: "completed" },
      });
    },
  });
}

/** The existing scheduled watch sweep owns one bounded turn for each collection. */
export async function sweepPlexLeavingSoon(context: MediaAutomationContext) {
  const runtime = await runtimeAuthority(context.db);
  if (!runtime.active) return;
  const execution = context.plexBindingExecution();
  const signal = AbortSignal.any([execution.signal, AbortSignal.timeout(6000)]);
  for (const target of COLLECTIONS) {
    try {
      const access = await context.plexAccess(target.sectionType);
      await sweepCollection(context, {
        target,
        access,
        epoch: runtime.epoch,
        signal,
      });
    } catch (error) {
      // A missing collection, failed readback or ambiguous add cannot adopt membership.
      if (!(error instanceof IntegrationError)) throw error;
    }
  }
}
