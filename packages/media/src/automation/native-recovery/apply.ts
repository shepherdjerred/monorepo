import { defaultScope } from "#shared/editions/scope.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  lockNativeScope,
  assertNativeSnapshot,
} from "#infrastructure/native-recovery/guards.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { verifyJournalProof } from "#automation/handoff/journals.ts";
import { rebindNativeSubtitles } from "#automation/native-subtitles/apply.ts";
import { appendNativeSubtitlePolicies } from "#automation/native-subtitles/policies.ts";
import { terminalPaths, terminalDependencies } from "./terminal-proof.ts";
import { settledJournals } from "./settled-proof.ts";
import {
  FinishedNativeSchema,
  stableNativeFiles,
  stableNativeNetwork,
} from "./plan.ts";
import {
  nativeApprovingActor,
  installNativeAuthority,
  assertNativeEvidenceFresh,
} from "./authority.ts";
import {
  nativeLocalPath,
  type NativeFileContext,
  type PreparedNativeFiles,
} from "./files.ts";

export async function applyPreparedNative(
  context: NativeFileContext,
  input: { planId: string; operationId: string },
  prepared: PreparedNativeFiles,
): Promise<string> {
  return context.files.db.$transaction(
    async (tx) => {
      await lockNativeScope(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${input.planId} FOR UPDATE`;
      const previous = await tx.nativeRecoveryReceipt.findUnique({
        where: { planId: input.planId },
      });
      if (previous !== null) return previous.id;
      const { plan, runtime } = await assertNativeSnapshot(
        tx,
        input.planId,
        prepared.scope,
      );
      if (
        plan.state !== "applying" ||
        plan.planHash === null ||
        plan.expiresAt === null ||
        plan.expiresAt <= new Date()
      )
        throw new Error("Native owner approval missing or expired");
      const finished = FinishedNativeSchema.parse(plan.plan);
      if (
        snapshotHash(finished) !== plan.planHash ||
        finished.scopeHash !== snapshotHash(z.json().parse(prepared.scope)) ||
        snapshotHash(finished.files) !==
          snapshotHash(z.json().parse(stableNativeFiles(prepared.evidence)))
      )
        throw new Error("Native reviewed physical identity changed");
      const observed = await tx.nativeRecoveryObservation.findFirstOrThrow({
        where: { planId: input.planId, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      const network = NativeRecoveryNetworkEvidenceSchema.parse(
        observed.evidence,
      );
      if (
        network.planId !== input.planId ||
        observed.expiresAt <= new Date() ||
        network.recoveryEpoch !== runtime.recoveryEpoch ||
        snapshotHash(finished.network) !==
          snapshotHash(z.json().parse(stableNativeNetwork(network)))
      )
        throw new Error("Native reviewed network identity changed");
      const actorId = await nativeApprovingActor(tx, input, plan.planHash);
      return withNativeIdentities(context, prepared, 0, async () => {
        if (
          observed.evidenceHash !== snapshotHash(z.json().parse(network)) ||
          observed.observedAt > new Date() ||
          observed.expiresAt <= new Date() ||
          observed.expiresAt.getTime() - observed.observedAt.getTime() > 120_000
        )
          throw new Error(
            "Native network evidence expired before final authority",
          );
        await installNativeAuthority(tx, context, {
          scope: prepared.scope,
          network,
        });
        for (const journal of prepared.journals)
          await verifyJournalProof(journal);
        assertNativeEvidenceFresh(network);
        const bindings = [];
        for (const file of prepared.scope.files) {
          const evidence = prepared.evidence.files.find(
            (item) => item.assetId === file.assetId,
          );
          if (evidence === undefined)
            throw new Error("Native reviewed file evidence missing");
          await tx.libraryAsset.update({
            where: { id: file.assetId },
            data: {
              ownershipEpoch: runtime.recoveryEpoch,
              version: { increment: 1 },
            },
          });
          const subtitles = await rebindNativeSubtitles(tx, {
            file,
            evidence: evidence.subtitles,
            content: prepared.content,
            newAssetVersion: file.assetVersion + 1,
            epoch: runtime.recoveryEpoch,
            resolvePath: (canonical) => nativeLocalPath(context, canonical),
          });
          bindings.push({
            assetId: file.assetId,
            beforeVersion: file.assetVersion,
            assetVersion: file.assetVersion + 1,
            checksum: file.checksum,
            mediaIds: file.mediaIds,
            ownershipEpoch: runtime.recoveryEpoch,
            subtitles,
          });
        }
        const policies = await appendNativeSubtitlePolicies(tx, {
          policies: prepared.scope.subtitlePolicies,
          epoch: runtime.recoveryEpoch,
          actorId,
          planId: input.planId,
        });
        for (const media of prepared.scope.media) {
          await tx.recoveryHold.upsert({
            where: targetWhere(defaultScope(media.id)),
            create: {
              mediaId: media.id,
              recoveryEpoch: runtime.recoveryEpoch,
              reason: "recovery_request_history_unconfirmed",
            },
            update: {
              recoveryEpoch: runtime.recoveryEpoch,
              reason: "recovery_request_history_unconfirmed",
              releasedAt: null,
              releasedById: null,
              releaseEvidence: Prisma.DbNull,
              version: { increment: 1 },
            },
          });
          await tx.mediaItem.update({
            where: { id: media.id },
            data: { availability: "available", version: { increment: 1 } },
          });
          await mirrorDefaultAvailability(tx, [media.id], "available");
        }
        await tx.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: {
            mode: "active",
            ownershipConfirmed: true,
            version: { increment: 1 },
          },
        });
        const receipt = await tx.nativeRecoveryReceipt.create({
          data: {
            planId: input.planId,
            planHash: z.string().parse(plan.planHash),
            recoveryEpoch: runtime.recoveryEpoch,
            previousRuntimeVersion: runtime.version,
            runtimeVersion: runtime.version + 1,
            actorId,
            selection: z.record(z.string(), z.json()).parse({
              scope: prepared.scope,
              fileEvidence: stableNativeFiles(prepared.evidence),
              networkEvidence: stableNativeNetwork(network),
              bindings,
              policies,
            }),
          },
        });
        await tx.nativeRecoveryPlan.update({
          where: { id: input.planId },
          data: { state: "applied", version: { increment: 1 } },
        });
        for (const media of prepared.scope.media)
          await tx.applicationEvent.create({
            data: {
              actorId,
              mediaId: media.id,
              kind: "native_recovery_applied",
              payload: {
                planId: input.planId,
                receiptId: receipt.id,
                recoveryEpoch: runtime.recoveryEpoch,
                physicalOwnershipOnly: true,
              },
            },
          });
        // Async marker/journal/subtitle checks can outlive the network lease.
        // Recheck at the commit boundary; all ownership writes roll back on expiry.
        for (const file of prepared.scope.files)
          await prepared.content.verifiedFile(
            nativeLocalPath(context, file.canonicalPath),
          );
        assertNativeEvidenceFresh(network);
        return receipt.id;
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function withNativeIdentities<T>(
  context: NativeFileContext,
  prepared: PreparedNativeFiles,
  index: number,
  action: () => Promise<T>,
): Promise<T> {
  if (prepared.scope.schemaVersion === 2)
    return withTerminalIdentities(context, prepared, index, action);
  const entries = prepared.scope.files
    .flatMap((file) => [
      { libraryKind: file.libraryKind, canonicalPath: file.canonicalPath },
      ...file.subtitles.flatMap((subtitle) =>
        subtitle.path === null
          ? []
          : [{ libraryKind: file.libraryKind, canonicalPath: subtitle.path }],
      ),
    ])
    .sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  const entry = entries[index];
  if (entry === undefined) return action();
  const roots = context.files.roots[entry.libraryKind];
  const local = nativeLocalPath(context, entry.canonicalPath);
  const proof = await prepared.content.verifiedFile(local);
  const operations = new FileOperations(roots, {
    authorize: () =>
      Promise.reject(new Error("Native rebaseline cannot mutate files")),
    ...(context.files.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
  });
  return operations.withFileIdentity(
    { ...proof, libraryPath: path.relative(roots.library, local) },
    () => withNativeIdentities(context, prepared, index + 1, action),
  );
}

async function withTerminalIdentities<T>(
  context: NativeFileContext,
  prepared: PreparedNativeFiles,
  index: number,
  action: () => Promise<T>,
): Promise<T> {
  const kind = (["movies", "tv"] as const)[index];
  if (kind === undefined) return action();
  const roots = context.files.roots[kind];
  const canonical = [
    ...terminalPaths(prepared.scope),
    ...prepared.scope.files.flatMap((file) => [
      file.canonicalPath,
      ...file.subtitles.flatMap((subtitle) =>
        subtitle.path === null ? [] : [subtitle.path],
      ),
    ]),
  ].filter((name) => name.startsWith(`/data/${kind}/`));
  const paths = [...new Set(canonical)].map((name) => {
    const local = nativeLocalPath(context, name);
    const control = name.startsWith(`/data/${kind}/.media-control/`);
    return {
      root: control ? ("control" as const) : ("library" as const),
      path: path.relative(control ? roots.control : roots.library, local),
    };
  });
  if (paths.length === 0)
    return withTerminalIdentities(context, prepared, index + 1, action);
  const operationIds = [
    ...terminalDependencies(prepared.scope).flatMap((item) => item.journals),
    ...settledJournals(prepared.scope),
  ]
    .filter((journal) => journal.target.startsWith(`/data/${kind}/`))
    .map((journal) => journal.operationId);
  const operations = new FileOperations(roots, {
    authorize: () =>
      Promise.reject(new Error("Native rebaseline cannot mutate files")),
    contentProof: prepared.content,
    ...(context.files.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
  });
  return operations.withContentPaths(
    paths,
    () => withTerminalIdentities(context, prepared, index + 1, action),
    operationIds,
  );
}
