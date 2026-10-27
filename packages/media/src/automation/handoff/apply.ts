import path from "node:path";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  HandoffNetworkProtocolSchema,
  handoffProtocolVersion,
} from "#shared/handoff/protocol.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { lockHandoffScopes } from "#infrastructure/handoff/scoped-snapshot.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { verifyControlExclusion } from "#filesystem/operations-io.ts";
import type { HandoffFileContext, PreparedHandoffFiles } from "./files.ts";
import {
  assertHandoffSnapshot,
  FinishedHandoffSchema,
  stableFiles,
  stableNetwork,
} from "./plan.ts";
import { verifyJournalProof } from "./journals.ts";
import { adoptHandoffRecords } from "./adopt.ts";
import { assertApplyActor, assertLatestLease } from "./final-guards.ts";
import { unmanagedSidecars } from "./sidecars.ts";
import { queueMediaSubtitleTargets } from "#automation/subtitles/queue.ts";
import { initialLibrarySnapshots } from "./library-snapshots.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertNoPendingPlexEdits } from "#infrastructure/handoff/plex-edit-records.ts";
import { readPlexEditProofsV1 } from "#infrastructure/handoff/plex-edit-proofs.ts";
import {
  handoffPlexIdentityV3,
  assertHandoffPlexLabelsV3,
} from "./plex-edit-plan.ts";

/** The hash work is complete; this transaction only checks exact identities and grants selected records. */
export async function applyPreparedHandoff(
  context: HandoffFileContext,
  input: { planId: string; operationId: string },
  prepared: PreparedHandoffFiles,
): Promise<string> {
  const { planId } = input;
  const db = context.files.db;
  const budget = new PublicationAuthorityReadBudget();
  return db.$transaction(
    async (tx) => {
      await lockHandoffScopes(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "MediaHandoffPlan" WHERE id = ${planId} FOR UPDATE`;
      const previous = await tx.mediaHandoffReceipt.findUnique({
        where: { planId },
      });
      if (previous !== null) return previous.id;
      const { plan, runtime } = await assertHandoffSnapshot(
        tx,
        planId,
        prepared.scope,
      );
      if (
        plan.state !== "applying" ||
        plan.planHash === null ||
        plan.expiresAt === null ||
        plan.expiresAt <= new Date()
      )
        throw new Error("Handoff owner approval is absent or expired");
      const authority = await runtimeAuthority(tx);
      if (prepared.scope.request.activation === "extend" && !authority.active)
        throw new Error("Handoff extension authority expired");
      const finished = FinishedHandoffSchema.parse(plan.plan);
      if (finished.schemaVersion !== handoffProtocolVersion(prepared.scope))
        throw new Error("Handoff finished plan protocol changed");
      if (
        snapshotHash(finished) !== plan.planHash ||
        finished.scopeHash !== snapshotHash(z.json().parse(prepared.scope)) ||
        snapshotHash(finished.files) !==
          snapshotHash(z.json().parse(stableFiles(prepared.evidence)))
      )
        throw new Error("Handoff file evidence changed after owner review");
      const observed = await tx.mediaHandoffObservation.findFirstOrThrow({
        where: { planId, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      const network = HandoffNetworkProtocolSchema.parse(observed.evidence);
      const stable = stableNetwork(network);
      if (
        snapshotHash(z.json().parse(observed.evidence)) !==
          observed.evidenceHash ||
        observed.expiresAt <= new Date() ||
        network.schemaVersion !== finished.schemaVersion ||
        network.recoveryEpoch !== runtime.recoveryEpoch ||
        !reviewedNetworkMatches(finished, stable)
      )
        throw new Error("Handoff network evidence changed after owner review");
      const actorId = await assertApplyActor(
        tx,
        {
          ...input,
          ...(finished.schemaVersion === 3 ? { protocol: 3 as const } : {}),
        },
        z.string().parse(plan.planHash),
      );
      await assertLatestLease(tx, network);
      const plexEdits = await libraryEditProofs(
        tx,
        {
          ...input,
          finished,
          stable,
          planHash: z.string().parse(plan.planHash),
          recoveryEpoch: runtime.recoveryEpoch,
        },
        budget,
      );
      await assertNoPendingPlexEdits(
        tx,
        prepared.scope.files,
        budget,
        finished.schemaVersion === 3 ? planId : undefined,
      );
      await assertClaims(tx, network);
      await installStorageAuthority(tx, context, network);
      return await withFileIdentities(context, prepared, 0, async () => {
        for (const proof of prepared.journals) await verifyJournalProof(proof);
        for (const file of prepared.evidence.files) {
          if (
            snapshotHash(await unmanagedSidecars(file.canonicalPath)) !==
            snapshotHash(file.unmanagedSidecars)
          )
            throw new Error("Handoff sidecar inventory changed");
        }
        await adoptHandoffRecords(tx, {
          planId,
          scope: prepared.scope,
          files: prepared.evidence,
          network,
          report: plan.bundleReview.report,
        });
        await tx.legacyWriterLease.upsert({
          where: { id: "singleton" },
          create: {
            id: "singleton",
            recoveryEpoch: runtime.recoveryEpoch,
            targetsDigest: network.quiescence.targetsDigest,
            configurationDigest: network.quiescence.configurationDigest,
            observation: network.quiescence,
            observedAt: new Date(network.quiescence.capturedAt),
            expiresAt: new Date(network.quiescence.expiresAt),
          },
          update: {
            recoveryEpoch: runtime.recoveryEpoch,
            targetsDigest: network.quiescence.targetsDigest,
            configurationDigest: network.quiescence.configurationDigest,
            observation: network.quiescence,
            observedAt: new Date(network.quiescence.capturedAt),
            expiresAt: new Date(network.quiescence.expiresAt),
            revokedAt: null,
            version: { increment: 1 },
          },
        });
        await tx.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: {
            mode: "active",
            ownershipConfirmed: true,
            version: { increment: 1 },
          },
        });
        if (!("schemaVersion" in prepared.scope))
          for (const selected of prepared.scope.media)
            await queueMediaSubtitleTargets(tx, selected.mediaId);
        const receipt = await tx.mediaHandoffReceipt.create({
          data: {
            planId,
            planHash: z.string().parse(plan.planHash),
            recoveryEpoch: runtime.recoveryEpoch,
            previousRuntimeVersion: runtime.version,
            runtimeVersion: runtime.version + 1,
            actorId,
            selection: {
              ...(await initialLibrarySnapshots(tx, prepared.scope, budget)),
              ...(plexEdits === undefined ? {} : { plexEdits }),
              scope: prepared.scope,
              fileEvidence: z.json().parse(stableFiles(prepared.evidence)),
              networkEvidence: stableNetwork(network),
              protected: prepared.scope.protected,
            },
          },
        });
        await tx.mediaHandoffPlan.update({
          where: { id: planId },
          data: { state: "applied", version: { increment: 1 } },
        });
        await tx.applicationEvent.create({
          data: {
            actorId,
            kind: "handoff_applied",
            payload: {
              planId,
              receiptId: receipt.id,
              recoveryEpoch: runtime.recoveryEpoch,
              runtimeVersion: runtime.version + 1,
            },
          },
        });
        return receipt.id;
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function libraryEditProofs(
  tx: Prisma.TransactionClient,
  input: {
    planId: string;
    operationId: string;
    planHash: string;
    recoveryEpoch: number;
    finished: z.infer<typeof FinishedHandoffSchema>;
    stable: unknown;
  },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.finished.schemaVersion !== 3) return;
  assertHandoffPlexLabelsV3(input.stable);
  return readPlexEditProofsV1(
    tx,
    { ...input, changes: input.finished.plexEdits },
    budget,
  );
}

function reviewedNetworkMatches(
  finished: z.infer<typeof FinishedHandoffSchema>,
  stable: unknown,
) {
  return finished.schemaVersion === 3
    ? snapshotHash(z.json().parse(handoffPlexIdentityV3(finished.network))) ===
        snapshotHash(z.json().parse(handoffPlexIdentityV3(stable)))
    : snapshotHash(finished.network) === snapshotHash(z.json().parse(stable));
}

async function assertClaims(
  tx: Prisma.TransactionClient,
  network: z.infer<typeof HandoffNetworkProtocolSchema>,
) {
  const ids = [...new Set(network.claims.map((item) => item.userId))].sort();
  if (ids.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
    );
  for (const claim of [...network.claims].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  )) {
    // Authentication can change these rows without updating MediaUser. Hold
    // their shared locks through adoption, in the network producer's order.
    await tx.$queryRaw`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" = ${claim.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Credential" WHERE id = ${claim.credentialId} FOR SHARE`;
    const user = await tx.mediaUser.findUniqueOrThrow({
      where: { id: claim.userId },
      include: { plexIdentity: true },
    });
    const credential = await tx.credential.findUniqueOrThrow({
      where: { id: claim.credentialId },
    });
    if (
      user.version !== claim.userVersion ||
      user.plexIdentity?.version !== claim.mappingVersion ||
      user.plexIdentity.serverMachineId !== claim.serverMachineId ||
      credential.updatedAt.toISOString() !== claim.credentialUpdatedAt ||
      credential.userId !== user.id
    )
      throw new Error("Handoff requester access changed");
  }
}

async function installStorageAuthority(
  tx: Prisma.TransactionClient,
  context: HandoffFileContext,
  network: z.infer<typeof HandoffNetworkProtocolSchema>,
) {
  if (
    !network.quiescence.quiescent ||
    network.quiescence.blockers.length > 0 ||
    Date.parse(network.quiescence.expiresAt) <= Date.now()
  )
    throw new Error("Handoff legacy writers are not proven stopped");
  for (const roots of [context.files.roots.movies, context.files.roots.tv]) {
    await verifyControlExclusion(roots, context.files.verifyPlexExclusion);
    const matching = network.mounts.bindings.filter(
      (item) =>
        item.canonical.root === roots.library &&
        item.canonical.podUid === context.workerPodUid,
    );
    const mount = matching[0]?.canonical;
    if (
      mount === undefined ||
      matching.length !== 1 ||
      Date.parse(network.mounts.expiresAt) <= Date.now()
    )
      throw new Error("Handoff executing storage binding missing");
    const previous = await tx.mediaStorageAuthority.findUnique({
      where: { rootPath: roots.library },
    });
    if (
      previous !== null &&
      previous.recoveryEpoch === network.recoveryEpoch &&
      (previous.pvcUid !== mount.pvcUid ||
        previous.volumePath !== mount.volumePath ||
        previous.volumeName !== mount.volumeName)
    )
      throw new Error(
        "Handoff cannot replace storage authority within an epoch",
      );
    const data = {
      recoveryEpoch: network.recoveryEpoch,
      pvcUid: mount.pvcUid,
      volumeName: mount.volumeName,
      volumePath: mount.volumePath,
      workerPodUid: context.workerPodUid,
      evidence: network.mounts,
      observedAt: new Date(network.mounts.capturedAt),
      expiresAt: new Date(network.mounts.expiresAt),
      revokedAt: null,
    };
    await tx.mediaStorageAuthority.upsert({
      where: { rootPath: roots.library },
      create: { rootPath: roots.library, ...data },
      update: { ...data, version: { increment: 1 } },
    });
  }
}

async function withFileIdentities<T>(
  context: HandoffFileContext,
  prepared: PreparedHandoffFiles,
  index: number,
  action: () => Promise<T>,
): Promise<T> {
  const entries = prepared.scope.files
    .flatMap((file) => [
      { ...file },
      ...prepared.scope.subtitles
        .filter(
          (subtitle) =>
            subtitle.assetId === file.assetId &&
            subtitle.canonicalPath !== null,
        )
        .map((subtitle) => ({
          libraryKind: file.libraryKind,
          canonicalPath: z.string().parse(subtitle.canonicalPath),
        })),
    ])
    .sort((a, b) =>
      a.canonicalPath < b.canonicalPath
        ? -1
        : a.canonicalPath > b.canonicalPath
          ? 1
          : 0,
    );
  const entry = entries[index];
  if (entry === undefined) return action();
  const roots = context.files.roots[entry.libraryKind];
  const proof = await prepared.content.verifiedFile(entry.canonicalPath);
  const operations = new FileOperations(roots, {
    authorize: () => Promise.reject(new Error("Handoff cannot mutate files")),
    ...(context.files.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
  });
  return operations.withFileIdentity(
    {
      ...proof,
      libraryPath: path.relative(roots.library, entry.canonicalPath),
    },
    () => withFileIdentities(context, prepared, index + 1, action),
  );
}
