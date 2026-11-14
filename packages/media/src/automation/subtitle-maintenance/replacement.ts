import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { SubtitleMatchScoreV1Schema } from "#shared/subtitle-maintenance/score.ts";
import type { SubtitleMaintenanceJobV1 } from "#shared/subtitle-maintenance/activities.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import { PrismaMovieSubtitleReplacements } from "#infrastructure/movie-editions/subtitle-replacement/service.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { captureReplacementSnapshot } from "#automation/subtitle-replacement/snapshot.ts";
import { captureMovieReplacementSnapshotV2 } from "#infrastructure/movie-editions/subtitle-replacement/snapshot.ts";
import { lockReplacement } from "#automation/subtitle-replacement/authority.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

type Input = { job: SubtitleMaintenanceJobV1; candidateSubtitleId: string };
const scoreOf = (value: unknown) =>
  SubtitleMatchScoreV1Schema.parse(
    z.object({ matchScoreV1: z.unknown() }).parse(value).matchScoreV1,
  );

export function automaticSubtitleReplacementV1(
  context: MediaAutomationContext,
  enabled: () => Promise<boolean>,
) {
  const access = async () => {
    const sections = await context.permittedSections();
    return requireMovieChoiceAccess({
      serverMachineId: context.serverMachineId,
      movieSectionId: sections.movie,
    });
  };
  const service = new PrismaSubtitleReplacements(
    context.db,
    context.describeWorkflow,
    access,
  );
  const movies = new PrismaMovieSubtitleReplacements(
    context.db,
    { keepDays: 30, movieAccess: access },
    context.describeWorkflow,
  );
  async function owner() {
    const owners = await context.db.mediaUser.findMany({
      where: { role: "owner", restricted: false },
      take: 2,
    });
    if (owners.length !== 1 || owners[0] === undefined)
      throw new FileGuardError("subtitle_maintenance_owner_unconfirmed");
    return owners[0];
  }
  async function checked(input: Input) {
    if (
      !(await enabled()) ||
      !(await context.gates.acquisition()) ||
      input.job.upgradeV1 === undefined
    )
      return null;
    const old = await context.db.subtitleAsset.findUniqueOrThrow({
      where: { id: input.job.upgradeV1.oldSubtitleId },
    });
    const candidate = await context.db.subtitleAsset.findUniqueOrThrow({
      where: { id: input.candidateSubtitleId },
    });
    const previous = scoreOf(old.matchingEvidence);
    const next = scoreOf(candidate.matchingEvidence);
    if (
      old.assetId !== input.job.assetId ||
      candidate.assetId !== old.assetId ||
      old.state !== "installed" ||
      candidate.state !== "validated" ||
      old.version !== input.job.upgradeV1.oldVersion ||
      old.checksum !== input.job.upgradeV1.oldChecksum ||
      old.checksum === candidate.checksum ||
      previous.score !== input.job.upgradeV1.minimumScore.score ||
      next.referenceHash !== previous.referenceHash ||
      next.kind !== previous.kind ||
      next.score <= previous.score
    )
      throw new FileGuardError("subtitle_automatic_upgrade_changed");
    const provenance = z
      .object({ operationId: z.literal(input.job.operationId) })
      .parse(candidate.matchingEvidence);
    const operation = await context.db.operation.findUniqueOrThrow({
      where: { id: provenance.operationId },
    });
    const claim = z
      .object({
        subtitleDownload: z.object({
          eventId: z.uuid(),
          requestedAt: z.iso.datetime(),
          providerId: z.literal(candidate.providerId),
          candidateId: z.string().min(1),
        }),
      })
      .parse(operation.result);
    const download = await context.db.applicationEvent.findUniqueOrThrow({
      where: { id: claim.subtitleDownload.eventId },
    });
    z.object({
      operationId: z.literal(operation.id),
      providerId: z.literal(candidate.providerId),
      candidateId: z.literal(claim.subtitleDownload.candidateId),
      requestedAt: z.literal(claim.subtitleDownload.requestedAt),
    }).parse(download.payload);
    if (download.kind !== "subtitle_download_requested")
      throw new FileGuardError("subtitle_download_parent_changed");
    return { old, candidate, previous, next };
  }
  return {
    async begin(input: Input) {
      const checkedInput = await checked(input);
      if (checkedInput === null) return null;
      const actor = await owner();
      const evidence = z
        .record(z.string(), z.json())
        .parse(checkedInput.candidate.matchingEvidence);
      if (evidence["automaticSubtitleUpgradeV1"] === undefined) {
        const eventId = crypto.randomUUID();
        await serializable(context.db, async (tx) => {
          await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE id=${checkedInput.candidate.id} FOR UPDATE`;
          const current = await tx.subtitleAsset.findUniqueOrThrow({
            where: { id: checkedInput.candidate.id },
          });
          if (
            current.version !== checkedInput.candidate.version ||
            current.checksum !== checkedInput.candidate.checksum
          )
            throw new FileGuardError("subtitle_candidate_changed");
          await tx.subtitleAsset.update({
            where: { id: current.id },
            data: {
              matchingEvidence: {
                ...evidence,
                replacementFor: {
                  oldSubtitleId: checkedInput.old.id,
                  expectedOldVersion: checkedInput.old.version,
                },
                automaticSubtitleUpgradeV1: { schemaVersion: 1, eventId },
              },
            },
          });
          await tx.applicationEvent.create({
            data: {
              id: eventId,
              actorId: actor.id,
              mediaId: input.job.movieScope?.mediaId ?? null,
              kind: "subtitle_automatic_upgrade_candidate_v1",
              payload: z.record(z.string(), z.json()).parse({
                operationId: input.job.operationId,
                subtitleId: current.id,
                oldSubtitleId: checkedInput.old.id,
                oldVersion: checkedInput.old.version,
                assetId: input.job.assetId,
                checksum: current.checksum,
                scope: input.job.movieScope ?? null,
                targetAuthority: input.job.targetAuthority,
                oldScore: checkedInput.previous,
                score: checkedInput.next,
              }),
            },
          });
        });
      }
      const raw = {
        oldSubtitleId: checkedInput.old.id,
        candidateSubtitleId: checkedInput.candidate.id,
        expectedOldVersion: checkedInput.old.version,
        expectedCandidateVersion: checkedInput.candidate.version,
      };
      const key = `subtitle-automatic-prepare:${input.job.operationId}:${checkedInput.candidate.id}`;
      const prepared =
        input.job.movieScope === undefined
          ? await service.prepare(actor, key, raw)
          : await movies.prepare(actor, key, {
              ...raw,
              schemaVersion: 2,
              scope: input.job.movieScope,
            });
      return {
        replacementId: z.uuid().parse(prepared.subtitleReplacementId),
        preparationOperationId: z.uuid().parse(prepared.operationId),
      };
    },
    async approve(
      input: Input & { replacementId: string },
    ): Promise<"waiting" | "queued" | "protected"> {
      const existing = await context.db.subtitleReplacement.findUniqueOrThrow({
        where: { id: input.replacementId },
        include: { receipt: true },
      });
      if (
        existing.assetId !== input.job.assetId ||
        existing.oldSubtitleId !== input.job.upgradeV1?.oldSubtitleId ||
        existing.candidateSubtitleId !== input.candidateSubtitleId
      )
        throw new FileGuardError("subtitle_replacement_changed");
      // A lost activity reply may be retried after the native swap has already
      // changed both captions. Its durable coordinator owns that outcome.
      if (existing.state === "applying" || existing.receipt !== null)
        return "queued";
      const selected = await checked(input);
      if (selected === null) return "protected";
      const actor = await owner();
      const movieAccess =
        input.job.movieScope === undefined ? undefined : await access();
      return serializable(context.db, async (tx) => {
        const { row, scope } = await lockReplacement(tx, input.replacementId);
        if (
          row.ownerId !== actor.id ||
          row.assetId !== input.job.assetId ||
          row.oldSubtitleId !== selected.old.id ||
          row.candidateSubtitleId !== selected.candidate.id
        )
          throw new FileGuardError("subtitle_replacement_changed");
        if (row.state === "applying" || row.receipt !== null) return "queued";
        if (row.state === "preparing") return "waiting";
        if (
          row.state !== "awaiting_review" ||
          row.review === null ||
          row.review.expiresAt <= new Date()
        )
          return "protected";
        const runtime = await runtimeAuthority(tx);
        if (!runtime.active || runtime.epoch !== input.job.recoveryEpoch)
          return "protected";
        let current;
        if (scope.schemaVersion === 1)
          current = await captureReplacementSnapshot(tx, {
            assetId: row.assetId,
            oldSubtitleId: row.oldSubtitleId,
            candidateSubtitleId: row.candidateSubtitleId,
            epoch: row.recoveryEpoch,
          });
        else {
          const capture = await captureMovieReplacementSnapshotV2(
            tx,
            {
              scope: scope.scope,
              assetId: row.assetId,
              oldSubtitleId: row.oldSubtitleId,
              candidateSubtitleId: row.candidateSubtitleId,
              epoch: row.recoveryEpoch,
            },
            {
              access: requireMovieChoiceAccess(movieAccess ?? {}),
              budget: new PublicationAuthorityReadBudget(),
            },
          );
          current = capture.snapshot;
        }
        if (snapshotHash(nativeJson(current)) !== row.snapshotHash)
          return "protected";
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "subtitle_automatic_upgrade_authorized_v1",
            dedupeKey: `subtitle-automatic-authorization:${row.id}`,
            payload: {
              replacementId: row.id,
              operationId: input.job.operationId,
              snapshotHash: row.snapshotHash,
              observationHash: row.review.observationHash,
              expiresAt: row.review.expiresAt.toISOString(),
              policy: "bazarr-personal-v1",
            },
          },
        });
        const operationId = await queueOperation(tx, {
          key: `subtitle-automatic-apply:${row.id}:${row.review.observationHash}`,
          kind: "apply_subtitle_replacement",
          targetId: row.id,
          userId: actor.id,
          payload: {
            replacementId: row.id,
            observationHash: row.review.observationHash,
            actorId: actor.id,
            automaticSubtitleUpgradeV1: true,
            ...(scope.schemaVersion === 2 ? { movieScope: scope.scope } : {}),
          },
        });
        await tx.subtitleReplacement.update({
          where: { id: row.id },
          data: {
            state: "applying",
            version: { increment: 1 },
            coordinatorOperationId: operationId,
          },
        });
        return "queued";
      });
    },
  };
}
