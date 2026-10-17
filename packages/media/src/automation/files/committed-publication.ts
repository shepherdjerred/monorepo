import nodePath from "node:path";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import type { VerifiedFileProof } from "#filesystem/verification.ts";
import { assertAcquisition, lockMedia } from "./guards.ts";
import { fileOperations } from "./file-operations.ts";
import { storedMeasuredRelease } from "./quality-guard.ts";
import {
  FileGuardError,
  FilePlanSchema,
  type FileContext,
  type FilePlanEntry,
  type Transaction,
} from "./types.ts";

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((id) => right.includes(id))
  );
}

/** Hash outside PG, then validate current authority and file identity in PG → FS lock order. */
export async function resumeCommittedPublication(input: {
  context: FileContext;
  attemptId: string;
}): Promise<boolean> {
  const { context, attemptId } = input;
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  if (attempt.state !== "imported") return false;
  if (attempt.filePlan === null)
    throw new FileGuardError("committed_plan_missing");
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const coveredIds = plan.flatMap((entry) => entry.mediaIds);
  if (
    !sameIds(coveredIds, attempt.mediaIds) ||
    new Set(plan.map((entry) => entry.assetId)).size !== plan.length
  )
    throw new FileGuardError("committed_coverage_changed");
  // This early check avoids hashing a known-conflicted asset; it grants no authority.
  for (const entry of plan) {
    await assertCommittedAsset({
      tx: context.db,
      context,
      entry,
      releaseId: attempt.releaseId,
      recoveryEpoch: attempt.recoveryEpoch,
    });
  }
  const verified = await verifyEntries(context, plan);
  await context.db.$transaction(
    async (tx) => {
      await lockMedia(tx, attempt.mediaIds);
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      if (
        current.state !== "imported" ||
        current.releaseId !== attempt.releaseId ||
        !sameIds(current.mediaIds, attempt.mediaIds) ||
        JSON.stringify(FilePlanSchema.parse(current.filePlan)) !==
          JSON.stringify(plan)
      )
        throw new FileGuardError("committed_plan_changed");
      if (!(await context.enabled.acquisition()))
        throw new FileGuardError("acquisition_disabled");
      // Checks adopted intent/reservation generations, never rewrites the physical-effect snapshot.
      await assertAcquisition(tx, attemptId);
      for (const entry of plan) {
        await assertCommittedAsset({
          tx,
          context,
          entry,
          releaseId: current.releaseId,
          recoveryEpoch: current.recoveryEpoch,
        });
        await assertCurrentProfiles(tx, entry);
      }
      await assertVerifiedIdentities(context, verified);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  return true;
}

async function assertCommittedAsset(input: {
  tx: Transaction;
  context: FileContext;
  entry: FilePlanEntry;
  releaseId: string;
  recoveryEpoch: number;
}): Promise<void> {
  const { tx, context, entry, releaseId } = input;
  const asset = await tx.libraryAsset.findUnique({
    where: { id: entry.assetId },
    include: { coverage: { where: { current: true } } },
  });
  if (
    asset === null ||
    !asset.owned ||
    asset.ownershipEpoch !== input.recoveryEpoch ||
    asset.state !== "published" ||
    asset.path !==
      nodePath.join(
        context.roots[entry.libraryKind].library,
        entry.libraryPath,
      ) ||
    asset.checksum !== entry.checksum ||
    asset.sizeBytes !== BigInt(entry.sizeBytes) ||
    !sameIds(
      asset.coverage.map((coverage) => coverage.mediaId),
      entry.mediaIds,
    )
  )
    throw new FileGuardError("committed_asset_changed");
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId: { in: entry.mediaIds }, current: true },
  });
  if (
    coverage.length !== entry.mediaIds.length ||
    coverage.some((item) => item.assetId !== entry.assetId)
  )
    throw new FileGuardError("committed_coverage_changed");
  const measured = storedMeasuredRelease(entry.properties);
  if (
    measured.id !== releaseId ||
    JSON.stringify(storedMeasuredRelease(asset.properties)) !==
      JSON.stringify(measured)
  )
    throw new FileGuardError("committed_properties_changed");
}

async function assertCurrentProfiles(
  tx: Transaction,
  entry: FilePlanEntry,
): Promise<void> {
  const measured = storedMeasuredRelease(entry.properties);
  for (const mediaId of entry.mediaIds) {
    const intent = await tx.mediaIntent.findUniqueOrThrow({
      where: { mediaId },
    });
    if (intent.profileId === null) throw new FileGuardError("profile_missing");
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "QualityProfile" WHERE id = ${intent.profileId} FOR SHARE`,
    );
    const profile = await tx.qualityProfile.findUniqueOrThrow({
      where: { id: intent.profileId },
    });
    const evaluation = evaluateRelease(
      measured,
      {
        ...QualityRulesSchema.parse(profile.rules),
        id: profile.id,
        version: profile.version,
      },
      [mediaId],
    );
    if (!evaluation.accepted)
      throw new FileGuardError("committed_profile_rejected");
  }
}

type VerifiedEntry = { entry: FilePlanEntry; proof: VerifiedFileProof };

async function verifyEntries(
  context: FileContext,
  plan: FilePlanEntry[],
): Promise<VerifiedEntry[]> {
  const verified: VerifiedEntry[] = [];
  for (const entry of plan) {
    const proof = await protectFileRead(
      async () =>
        await verificationOperations(context, entry).withVerifiedFile(
          {
            libraryPath: entry.libraryPath,
            sha256: entry.checksum,
            sizeBytes: entry.sizeBytes,
          },
          (identity) => Promise.resolve(identity),
        ),
    );
    verified.push({ entry, proof });
  }
  return verified;
}

async function assertVerifiedIdentities(
  context: FileContext,
  verified: VerifiedEntry[],
): Promise<void> {
  const [first, ...remaining] = verified;
  if (first === undefined) return;
  await protectFileRead(async () => {
    await verificationOperations(context, first.entry).withFileIdentity(
      first.proof,
      async () => {
        await assertVerifiedIdentities(context, remaining);
      },
    );
  });
}

function verificationOperations(context: FileContext, entry: FilePlanEntry) {
  return fileOperations(
    {
      ...context,
      checkpoint: async () => {
        await context.checkpoint("committed-publication-verification");
      },
    },
    context.roots[entry.libraryKind],
    () =>
      Promise.reject(new Error("Committed verification cannot mutate files")),
  );
}

async function protectFileRead<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof FileOperationConflict)
      throw new FileGuardError("committed_file_changed");
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      throw new FileGuardError("committed_file_missing");
    throw error;
  }
}
