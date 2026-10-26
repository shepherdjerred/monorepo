import path from "node:path";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import {
  FileGuardError,
  now,
  type FileContext,
} from "#automation/files/types.ts";
import type {
  SubtitleReplacementInput,
  SubtitleReplacementResult,
} from "#shared/subtitle-replacement.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  assertReplacementSnapshot,
  assertReplacementOperation,
  lockReplacement,
} from "./authority.ts";
import {
  proveReplacement,
  stageReplacement,
  assertReviewedProof,
  readReplacementJournal,
  type ReplacementProof,
} from "./files.ts";
import {
  ExecutionSchema,
  artifactIdentity,
  replacementEffectState,
} from "./execution.ts";
import { settleReplacement } from "./settle.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

export async function applyReplacement(
  initialContext: FileContext,
  input: SubtitleReplacementInput,
  reconcile = false,
): Promise<SubtitleReplacementResult> {
  let context = initialContext;
  const execution = context.publicationExecution?.();
  execution?.assertActive();
  let row = await context.db.$transaction(async (tx) => {
    const { row: current } = await lockReplacement(tx, input.replacementId);
    await assertReplacementOperation(
      tx,
      input,
      reconcile
        ? [
            "reconcile_subtitle_replacement",
            "apply_subtitle_replacement",
            ...(current.executionEvidence === null
              ? ["prepare_subtitle_replacement"]
              : []),
          ]
        : ["apply_subtitle_replacement"],
    );
    if (current.receipt !== null) return current;
    if (current.state !== (reconcile ? "reconciling" : "applying"))
      throw new FileGuardError("subtitle_replacement_coordinator_changed");
    if (!reconcile) {
      await assertReplacementSnapshot(tx, current.id);
      requireApproval(context, current.review, current.snapshotHash);
    }
    return current;
  });
  if (row.receipt !== null) return receiptResult(row.receipt.outcome);
  const invocation = publicationInvocation(
    context,
    requirePublicationExecution(execution),
  );
  context = invocation;
  if (reconcile && row.executionEvidence === null)
    return await abandonUnstarted(context, input);
  if (row.executionEvidence === null) {
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    await stageReplacement(context, row);
    const proof = await proveReplacement(context, row);
    if (row.review === null)
      throw new FileGuardError("subtitle_replacement_review_missing");
    await assertReviewedProof(proof, row.review.observation, true);
    for (const filename of [
      proof.paths.oldArchive,
      proof.paths.rejected,
      proof.paths.rollbackStaged,
      proof.paths.partial,
    ]) {
      if ((await proof.content.digest(filename)) !== null)
        throw new FileGuardError("subtitle_replacement_artifact_collision");
    }
    const evidence = ExecutionSchema.parse({
      schemaVersion: 1,
      source: await artifactIdentity(proof, proof.paths.source),
      staged: await artifactIdentity(proof, proof.paths.staged),
    });
    row = await context.db.$transaction(async (tx) => {
      const { row: current } = await lockReplacement(tx, input.replacementId);
      await assertReplacementOperation(tx, input, [
        "apply_subtitle_replacement",
      ]);
      if (current.state !== "applying")
        throw new FileGuardError("subtitle_replacement_coordinator_changed");
      await assertReplacementSnapshot(tx, current.id);
      requireApproval(context, current.review, current.snapshotHash);
      await proof.content.digest(proof.paths.source);
      await proof.content.digest(proof.paths.staged);
      if (
        current.executionEvidence !== null &&
        snapshotHash(z.json().parse(current.executionEvidence)) !==
          snapshotHash(evidence)
      )
        throw new FileGuardError("subtitle_replacement_execution_changed");
      await tx.subtitleReplacement.update({
        where: { id: current.id },
        data: { executionEvidence: evidence },
      });
      return await tx.subtitleReplacement.findUniqueOrThrow({
        where: { id: current.id },
        include: { review: true, receipt: true },
      });
    });
  }
  const proof = await proveReplacement(context, row);
  return await context.db.$transaction(
    async (tx) => {
      const { row: current } = await lockReplacement(tx, input.replacementId);
      const actorId = await assertReplacementOperation(
        tx,
        input,
        reconcile
          ? ["reconcile_subtitle_replacement", "apply_subtitle_replacement"]
          : ["apply_subtitle_replacement"],
      );
      if (current.receipt !== null)
        return receiptResult(current.receipt.outcome);
      if (current.state !== (reconcile ? "reconciling" : "applying"))
        throw new FileGuardError("subtitle_replacement_coordinator_changed");
      if (current.review === null)
        throw new FileGuardError("subtitle_replacement_review_missing");
      const effect = await replacementEffectState(
        proof,
        current,
        current.review.observation,
      );
      let forward = effect !== "restored";
      try {
        await assertReplacementSnapshot(tx, current.id);
        requireApproval(context, current.review, current.snapshotHash);
        if (!(await context.enabled.acquisition())) forward = false;
      } catch (error) {
        if (
          !(error instanceof FileGuardError) &&
          !(error instanceof MediaError && error.code === "forbidden")
        )
          throw error;
        forward = false;
      }
      const authorize = async () => {
        await assertReplacementSnapshot(
          tx,
          current.id,
          forward
            ? {}
            : {
                allowCompensation: true,
                ...(actorId === null ? {} : { actorId }),
              },
        );
        await proof.content.digest(proof.paths.video);
        if (forward && !(await context.enabled.acquisition()))
          throw new FileGuardError("acquisition_disabled");
        await context.checkpoint("subtitle-replacement-authorized");
      };
      await authorize();
      const freshness = await publicationAuthorityDeadline(
        tx,
        { ...invocation, contentProof: proof.content },
        {
          libraryKind: proof.paths.scope.libraryKind,
          recoveryEpoch: current.recoveryEpoch,
        },
      );
      const observed = { wall: Date.now(), monotonic: performance.now() };
      const reviewDeadline = current.review.expiresAt.getTime();
      const assertActive = () => {
        freshness.assertActive();
        if (
          forward &&
          (Date.now() >= reviewDeadline ||
            performance.now() >=
              observed.monotonic + reviewDeadline - observed.wall)
        )
          throw new FileGuardError("subtitle_replacement_approval_expired");
      };
      await bindPlexTransactionDeadline(tx, {
        assertActive,
        expiresAtMs: forward
          ? Math.min(freshness.expiresAtMs, reviewDeadline)
          : freshness.expiresAtMs,
      });
      const files = fileOperations(
        { ...context, contentProof: proof.content },
        { ...proof.paths.roots, downloads: proof.paths.roots.control },
        authorize,
        assertActive,
      );
      const identities = await Promise.all(
        [proof.paths.video, proof.paths.target].map(async (filename) => ({
          ...(await proof.content.verifiedFile(filename)),
          libraryPath: path.relative(proof.paths.roots.library, filename),
        })),
      );
      return await files.withFileIdentities(identities, async () => {
        await authorize();
        if (forward) {
          await files.importFile(proof.paths.descriptor);
          // Complete-import replay alone does not prove preserved old bytes.
          if (
            (await proof.content.digest(proof.paths.oldArchive)) !==
            proof.paths.scope.old.checksum
          )
            throw new FileGuardError("subtitle_replacement_archive_missing");
          await context.checkpoint("subtitle-replacement-before-receipt");
          await settleReplacement(tx, context, current, {
            outcome: "installed",
            proof,
          });
          assertActive();
          return { state: "applied" as const };
        }
        if (effect === "promoted")
          await files.rollbackImport({
            operationId: current.importOperationId,
            rollbackOperationId: current.rollbackOperationId,
            libraryPath: proof.paths.descriptor.libraryPath,
            sha256: proof.paths.descriptor.sha256,
            previousSha256: proof.paths.descriptor.previousSha256,
          });
        await context.checkpoint("subtitle-replacement-before-receipt");
        await settleReplacement(tx, context, current, {
          outcome: effect === "old" ? "abandoned" : "compensated",
          proof,
        });
        assertActive();
        return { state: "rolled_back" as const };
      }, [current.importOperationId, current.rollbackOperationId]);
    },
    { timeout: 30_000 },
  );
}

function requireApproval(
  context: FileContext,
  review: {
    approvedById: string | null;
    approvedAt: Date | null;
    observationHash: string;
    observation: unknown;
    expiresAt: Date;
  } | null,
  snapshot: string,
) {
  if (
    review?.approvedAt === null ||
    review?.approvedAt === undefined ||
    review.approvedById === null ||
    review.expiresAt <= now(context) ||
    snapshotHash(z.json().parse(review.observation)) !== review.observationHash
  )
    throw new FileGuardError("subtitle_replacement_approval_expired");
  const observed = review.observation;
  if (
    typeof observed !== "object" ||
    observed === null ||
    !("snapshotHash" in observed) ||
    observed.snapshotHash !== snapshot
  )
    throw new FileGuardError("subtitle_replacement_review_changed");
}

export function receiptResult(outcome: string): SubtitleReplacementResult {
  if (outcome === "installed") return { state: "applied" };
  if (outcome === "compensated" || outcome === "abandoned")
    return { state: "rolled_back" };
  throw new Error("Unknown subtitle replacement receipt outcome");
}

async function abandonUnstarted(
  context: FileContext,
  input: SubtitleReplacementInput,
): Promise<SubtitleReplacementResult> {
  const row = await context.db.subtitleReplacement.findUniqueOrThrow({
    where: { id: input.replacementId },
  });
  const proof = await proveReplacement(context, row);
  await assertNoArtifacts(
    proof,
    row.importOperationId,
    row.rollbackOperationId,
  );
  await context.db.$transaction(async (tx) => {
    const { row: current } = await lockReplacement(tx, input.replacementId);
    const actorId = await assertReplacementOperation(tx, input, [
      "reconcile_subtitle_replacement",
      "apply_subtitle_replacement",
      "prepare_subtitle_replacement",
    ]);
    if (current.receipt !== null) return;
    if (current.state !== "reconciling")
      throw new FileGuardError("subtitle_replacement_coordinator_changed");
    await assertReplacementSnapshot(tx, current.id, {
      allowCompensation: true,
      ...(actorId === null ? {} : { actorId }),
    });
    await assertNoArtifacts(
      proof,
      current.importOperationId,
      current.rollbackOperationId,
    );
    await settleReplacement(tx, context, current, {
      outcome: "abandoned",
      proof,
    });
  });
  return { state: "rolled_back" };
}

async function assertNoArtifacts(
  proof: ReplacementProof,
  importId: string,
  rollbackId: string,
) {
  for (const filename of [
    proof.paths.source,
    proof.paths.staged,
    proof.paths.partial,
    proof.paths.oldArchive,
    proof.paths.rejected,
    proof.paths.rollbackStaged,
  ]) {
    if ((await proof.content.digest(filename)) !== null)
      throw new FileGuardError(
        "subtitle_replacement_artifact_ownership_unconfirmed",
      );
  }
  if (
    (await readReplacementJournal(proof.paths, importId)) !== null ||
    (await readReplacementJournal(proof.paths, rollbackId)) !== null
  )
    throw new FileGuardError("subtitle_replacement_journal_requires_review");
  if (
    (await proof.content.digest(proof.paths.target)) !==
    proof.paths.scope.old.checksum
  )
    throw new FileGuardError("subtitle_replacement_bytes_changed");
}
