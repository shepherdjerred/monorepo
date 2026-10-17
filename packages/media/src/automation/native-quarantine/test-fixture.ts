import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { nativeStorageFixture } from "#automation/native-recovery/test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PrismaNativeQuarantine } from "#infrastructure/native-quarantine/service.ts";
import { createNativeQuarantineObserver } from "#migration/native-network/quarantine.ts";
import { NativeQuarantineContinuationSchema } from "#shared/native-recovery/quarantine.ts";
import { queueOperation } from "#automation/store.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";
import type { fileFixture } from "#automation/files/test-support.ts";
import { createNativeQuarantineFileActivities } from "./activities.ts";

export async function nativeQuarantineFixture(
  db: Database,
  cipher: CredentialCipher,
  beforeQuarantine?: (input: {
    file: Awaited<ReturnType<typeof fileFixture>>;
    published: Awaited<
      ReturnType<Awaited<ReturnType<typeof fileFixture>>["published"]>
    >;
  }) => Promise<void>,
) {
  const setup = await nativeStorageFixture(db, cipher, "removed", {
    beforeRestore: async ({ file, published, subtitleId, canonicalPath }) => {
      const subtitle = await db.subtitleAsset.findUniqueOrThrow({
        where: { id: subtitleId },
      });
      const subtitlePath = z.string().parse(subtitle.path);
      await db.libraryAsset.update({
        where: { id: published.entry.assetId },
        data: {
          path: path.join(file.roots.library, published.entry.libraryPath),
        },
      });
      await db.subtitleAsset.update({
        where: { id: subtitleId },
        data: {
          path: path.join(
            file.roots.library,
            path.relative("/data/movies", subtitlePath),
          ),
        },
      });
      const unverifiedPath = path.join(
        file.roots.library,
        published.entry.libraryPath.replace(/\.[^.]+$/u, ".zh-Hans.srt"),
      );
      const unverified =
        "1\n00:00:00,000 --> 00:00:01,000\nUnknown legacy script quality\n";
      await writeFile(unverifiedPath, unverified);
      const unknown = await db.subtitleAsset.create({
        data: {
          assetId: published.entry.assetId,
          state: "installed",
          storageKind: "sidecar",
          qualityStatus: "unverified",
          language: "zh-Hans",
          providerId: "legacy-fixture",
          path: unverifiedPath,
          checksum: createHash("sha256").update(unverified).digest("hex"),
          videoChecksum: published.entry.checksum,
          videoVersion: 0,
          ownershipEpoch: 0,
          provenance: { exactLegacyBytes: true },
          matchingEvidence: { ownershipOnly: true },
        },
      });
      const inspect = file.context.inspect;
      if (inspect === undefined)
        throw new Error("Quarantine fixture inspector missing");
      file.context.inspect = async (filename) => {
        const probe = await inspect(filename);
        return {
          ...probe,
          streams: [
            ...probe.streams,
            {
              index: 2,
              codec_type: "subtitle",
              codec_name: "subrip",
              tags: { language: "eng" },
              disposition: { forced: 0, hearing_impaired: 0 },
            },
          ],
        };
      };
      await db.subtitleAsset.create({
        data: {
          assetId: published.entry.assetId,
          state: "installed",
          storageKind: "embedded",
          qualityStatus: "rejected",
          language: "en",
          providerId: "embedded",
          streamIndex: 2,
          codec: "subrip",
          forced: false,
          hearingImpaired: false,
          videoChecksum: published.entry.checksum,
          videoVersion: 0,
          ownershipEpoch: 0,
          provenance: { rejection: "synthetic quality rejection retained" },
          matchingEvidence: { rejected: true },
        },
      });
      await beforeQuarantine?.({ file, published });
      const retained = await file.retention();
      const operation = await db.operation.create({
        data: {
          kind: "retain_media",
          targetId: file.media.id,
          payload: {
            mediaId: file.media.id,
            generation: retained.decision.generation,
            recoveryEpoch: 0,
          },
        },
      });
      const result = await createMediaFileActivities(
        file.context,
      ).quarantineMediaFiles({
        decisionId: retained.decision.id,
        operationId: operation.id,
      });
      if (result.status !== "quarantined")
        throw new Error(`Fixture quarantine failed: ${JSON.stringify(result)}`);
      await db.libraryAsset.update({
        where: { id: published.entry.assetId },
        data: { path: canonicalPath },
      });
      await db.subtitleAsset.update({
        where: { id: subtitleId },
        data: { path: subtitlePath },
      });
      await db.subtitleAsset.update({
        where: { id: unknown.id },
        data: {
          path: `/data/movies/${path.relative(file.roots.library, unverifiedPath)}`,
        },
      });
    },
  });
  setup.prior.context.plex.libraryPage = () =>
    Promise.resolve({ total: 0, items: [] });
  setup.context.files.verifyStorageAuthority = (roots) =>
    requireStorageAuthority(
      db,
      roots.library === setup.file.context.roots.movies.library
        ? "/data/movies"
        : "/data/tv",
      setup.context.workerPodUid,
    );
  const observerContext = {
    ...setup.prior.context,
    plex: {
      machineIdentifier: setup.prior.context.plex.machineIdentifier.bind(
        setup.prior.context.plex,
      ),
      metadata: setup.prior.context.plex.metadata.bind(
        setup.prior.context.plex,
      ),
      sections: setup.prior.context.plex.sections.bind(
        setup.prior.context.plex,
      ),
      libraryPage: setup.prior.context.plex.libraryPage.bind(
        setup.prior.context.plex,
      ),
      activeSessions: () => Promise.resolve([]),
    },
  };
  const service = new PrismaNativeQuarantine(db);
  const prepared = await service.prepare(
    setup.prior.actor,
    crypto.randomUUID(),
    {
      lifecycleKind: "committed_quarantine",
      restoreOperationId: setup.restore.id,
      recoveryEpoch: setup.runtime.recoveryEpoch,
      runtimeVersion: setup.runtime.version,
      activation: "activate",
      assetIds: [setup.asset.id],
    },
  );
  const planId = z.uuid().parse(prepared.nativeRecoveryId);
  const activities = createNativeQuarantineFileActivities(setup.context);
  const observe = () => createNativeQuarantineObserver(observerContext)(planId);
  const prepare = async () => {
    await observe();
    await activities.prepareNativeQuarantineFiles({
      planId,
      operationId: z.uuid().parse(prepared.operationId),
    });
    return await db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: planId },
    });
  };
  const approve = async () => {
    const plan = await prepare();
    return await service.apply(setup.prior.actor, crypto.randomUUID(), planId, {
      expectedVersion: plan.version,
      planHash: z.string().parse(plan.planHash),
      recoveryEpoch: setup.runtime.recoveryEpoch,
      runtimeVersion: setup.runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    });
  };
  const apply = async () => {
    const approval = await approve();
    await observe();
    await activities.applyNativeQuarantineFiles({
      planId,
      operationId: z.uuid().parse(approval.operationId),
    });
    return await db.nativeQuarantineContinuation.findFirstOrThrow({
      where: { receipt: { planId } },
    });
  };
  const positiveRestore = async () => {
    const continuation = await db.nativeQuarantineContinuation.findFirstOrThrow(
      { where: { receipt: { planId } } },
    );
    const descriptor = NativeQuarantineContinuationSchema.parse(
      continuation.descriptor,
    );
    const operationId = await db.$transaction(async (tx) => {
      await tx.mediaIntent.updateMany({
        where: { mediaId: { in: descriptor.group.mediaIds } },
        data: {
          desiredPresence: true,
          monitoring: true,
          intentionallyRemovedAt: null,
          automationEpoch: continuation.recoveryEpoch,
          generation: { increment: 1 },
        },
      });
      const intent = await tx.mediaIntent.findUniqueOrThrow({
        where: { mediaId: setup.file.media.id },
      });
      return await queueOperation(tx, {
        key: `native-fixture-positive:${crypto.randomUUID()}`,
        kind: "restore_media",
        targetId: intent.mediaId,
        payload: { mediaId: intent.mediaId, generation: intent.generation },
      });
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: operationId },
    });
    return z
      .object({
        operationId: z.uuid(),
        continuationId: z.uuid(),
        mediaId: z.uuid(),
        generation: z.int(),
      })
      .parse(operation.payload);
  };
  const bytes = async () => {
    const decision = await db.retentionDecision.findFirstOrThrow({
      where: { mediaId: setup.file.media.id, state: "quarantined" },
    });
    const manifest = z
      .object({ assets: z.array(z.object({ quarantineId: z.uuid() })) })
      .parse(decision.manifest);
    return await readFile(
      path.join(
        setup.file.roots.control,
        "quarantine",
        z.string().parse(manifest.assets[0]?.quarantineId),
      ),
      "utf8",
    );
  };
  return {
    ...setup,
    observerContext,
    db,
    service,
    prepared,
    planId,
    activities,
    observe,
    prepare,
    approve,
    apply,
    positiveRestore,
    bytes,
  };
}
