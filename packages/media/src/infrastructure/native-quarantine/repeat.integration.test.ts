import { afterAll, expect, test } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeQuarantineFixture } from "#automation/native-quarantine/test-fixture.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { createNativeQuarantineObserver } from "#migration/native-network/quarantine.ts";
import { createNativeRecoveryObserver } from "#migration/native-network/producer.ts";
import { createNativeFileActivities } from "#automation/native-recovery/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import {
  replaceRecoveredSidecar,
  addRecoveredSidecar,
} from "./repeat-replacement-support.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const f = await nativeQuarantineFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(f.file.directory);
  await f.apply();
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function secondRestore(f: Fixture, expectedEpoch = 1) {
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(f.db, {
    recoveryId,
    expectedEpoch,
    reason: "Repeated quarantine recovery regression",
  });
  for (const proof of await grantTestExclusionProofs(f.db, f.prior.actor.id)) {
    const roots =
      f.context.files.roots[
        proof.libraryRoot === "/data/movies" ? "movies" : "tv"
      ];
    await writeFile(
      path.join(roots.library, ".plexignore"),
      proof.rootMarkerAfter,
    );
    await writeFile(
      path.join(roots.control, ".plexignore"),
      proof.controlMarkerAfter,
    );
  }
  const restore = await f.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  const runtime = await f.db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  return {
    restoreOperationId: restore.id,
    recoveryEpoch: expectedEpoch + 1,
    runtimeVersion: runtime.version,
    activation: "activate" as const,
    assetIds: [f.asset.id],
  };
}
async function approve(
  f: Fixture,
  command: {
    nativeRecoveryId?: string | undefined;
    operationId?: string | undefined;
  },
  input: Awaited<ReturnType<typeof secondRestore>>,
) {
  const service = new PrismaNativeRecovery(f.db);
  const planId = z.uuid().parse(command.nativeRecoveryId);
  const detail = await service.detail(f.prior.actor, planId);
  const approved = await service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    planId,
    {
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: input.recoveryEpoch,
      runtimeVersion: input.runtimeVersion,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  return { planId, operationId: z.uuid().parse(approved.operationId) };
}
test.each([false, true])(
  "second restore of pending quarantine uses exact prior physical receipt (negative household release=%s)",
  async (negative) => {
    const f = await fixture();
    if (negative) await negativeHousehold(f);
    const decisions = await f.db.retentionDecision.findMany({
      where: { mediaId: f.file.media.id },
    });
    const before = await f.bytes();
    const input = await secondRestore(f);
    const command = await f.service.prepare(
      f.prior.actor,
      crypto.randomUUID(),
      {
        ...input,
        lifecycleKind: "committed_quarantine",
      },
    );
    const planId = z.uuid().parse(command.nativeRecoveryId);
    const observe = createNativeQuarantineObserver(f.observerContext);
    await observe(planId);
    await f.activities.prepareNativeQuarantineFiles({
      planId,
      operationId: z.uuid().parse(command.operationId),
    });
    const applied = await approve(f, command, input);
    await observe(planId);
    await f.activities.applyNativeQuarantineFiles(applied);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ state: "quarantined", version: 3, ownershipEpoch: 2 });
    expect(
      await f.db.retentionDecision.findMany({
        where: { mediaId: f.file.media.id },
      }),
    ).toEqual(decisions);
    expect(await f.bytes()).toBe(before);
    const subtitles = await f.db.subtitleAsset.findMany({
      where: { assetId: f.asset.id },
    });
    expect(
      subtitles.every(
        (item) =>
          item.state === "quarantined" &&
          item.ownershipEpoch === 2 &&
          item.videoVersion === 3,
      ),
    ).toBe(true);
  },
);

test.each(["version", "subtitle"] as const)(
  "pending native receipt rejects changed %s on repeated restore",
  async (change) => {
    const f = await fixture();
    if (change === "version")
      await f.db.libraryAsset.update({
        where: { id: f.asset.id },
        data: { version: { increment: 1 } },
      });
    else
      await f.db.subtitleAsset.update({
        where: { id: f.subtitle.id },
        data: { provenance: { unreviewed: true } },
      });
    const input = await secondRestore(f);
    await expect(
      f.service.prepare(f.prior.actor, crypto.randomUUID(), {
        ...input,
        lifecycleKind: "committed_quarantine",
      }),
    ).rejects.toThrow(
      change === "version"
        ? "different video version"
        : "exact pending native receipt",
    );
  },
);

test.each([
  "valid",
  "replacement",
  "missing_journal",
  "control_reappears",
  "added",
  "added_epoch",
  "added_journal",
  "added_bytes",
] as const)(
  "completed quarantine restoration dependency requires exact physical proof: %s",
  async (mode) => {
    const f = await fixture();
    const restore = await f.positiveRestore();
    await f.activities.restoreNativeQuarantineFiles(restore);
    const media = await f.db.mediaItem.findUniqueOrThrow({
      where: { id: f.file.media.id },
    });
    const item = {
      ratingKey: "99123",
      title: media.title,
      type: "movie" as const,
      Guid: [{ id: `tmdb://${String(media.tmdbId)}` }],
      Media: [{ Part: [{ id: 1, file: f.canonicalPath }] }],
    };
    f.observerContext.plex.libraryPage = () =>
      Promise.resolve({ total: 1, items: [item] });
    f.observerContext.plex.metadata = () => Promise.resolve(item);
    const network = harness.context();
    network.plex.sections = f.observerContext.plex.sections;
    network.plex.libraryPage = f.observerContext.plex.libraryPage;
    network.plex.metadata = f.observerContext.plex.metadata;
    network.plex.refresh = () => Promise.resolve();
    expect(
      await createPublicationActivities(network).publishRestoredMedia(restore),
    ).toMatchObject({ status: "available" });
    if (mode === "replacement") {
      await negativeHousehold(f, "request");
      await replaceRecoveredSidecar(f, harness.context().cipher);
    }
    const added = mode.startsWith("added")
      ? await addRecoveredSidecar(f, harness.context().cipher)
      : null;
    if (mode === "added_epoch" && added !== null)
      await f.db.subtitleAsset.update({
        where: { id: added.subtitleId },
        data: { ownershipEpoch: 0 },
      });
    const input = await secondRestore(f);
    const service = new PrismaNativeRecovery(f.db);
    if (mode === "added_epoch") {
      await expect(
        service.prepare(f.prior.actor, crypto.randomUUID(), input),
      ).rejects.toThrow();
      return;
    }
    const command = await service.prepare(
      f.prior.actor,
      crypto.randomUUID(),
      input,
    );
    const planId = z.uuid().parse(command.nativeRecoveryId);
    const continuation =
      await f.db.nativeQuarantineContinuation.findUniqueOrThrow({
        where: { id: restore.continuationId },
      });
    const descriptor = z
      .object({
        participants: z.array(
          z.object({
            quarantineId: z.uuid(),
            libraryKind: z.enum(["movies", "tv"]),
          }),
        ),
      })
      .parse(continuation.descriptor);
    const participant = descriptor.participants[0];
    if (participant === undefined)
      throw new Error("Fixture participant missing");
    if (mode === "missing_journal")
      await rm(
        path.join(
          f.context.files.roots[participant.libraryKind].control,
          "journal",
          `native-restore-${restore.continuationId}-${participant.quarantineId}.json`,
        ),
      );
    if (mode === "control_reappears")
      await writeFile(
        path.join(
          f.context.files.roots[participant.libraryKind].control,
          "quarantine",
          participant.quarantineId,
        ),
        "foreign old control contents",
      );
    if (mode === "added_journal" && added !== null)
      await rm(
        path.join(f.file.roots.control, "journal", `${added.operationId}.json`),
      );
    if (mode === "added_bytes" && added !== null)
      await writeFile(
        path.join(
          f.file.roots.library,
          path.relative("/data/movies", z.string().parse(added.subtitle.path)),
        ),
        "mutated caption",
      );
    const observe = createNativeRecoveryObserver(f.observerContext);
    await observe(planId);
    const files = createNativeFileActivities(f.context);
    const preparation = files.prepareNativeRecoveryFiles({
      planId,
      operationId: z.uuid().parse(command.operationId),
    });
    const expectedFailure: Record<string, string> = {
      missing_journal: "journal is missing",
      control_reappears: "artifact contradicts",
      added_journal: "one exact installation journal",
      added_bytes: "subtitle bytes changed",
    };
    const reason = expectedFailure[mode];
    if (reason !== undefined) {
      await expect(preparation).rejects.toThrow(reason);
      expect(
        await f.db.nativeRecoveryReceipt.count({ where: { planId } }),
      ).toBe(0);
      return;
    }
    await preparation;
    const reviewed = await service.detail(f.prior.actor, planId);
    expect(reviewed.scope).toMatchObject({
      schemaVersion: 2,
      lifecycleKind: "published",
      settledQuarantines: [{ continuationId: restore.continuationId }],
    });
    const approved = await approve(f, command, input);
    await observe(planId);
    await files.applyNativeRecoveryFiles(approved);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ state: "published", ownershipEpoch: 2, version: 4 });
    expect(
      await f.db.retentionDecision.findFirstOrThrow({
        where: { mediaId: media.id },
      }),
    ).toMatchObject({ state: "quarantined" });
    const thirdInput = await secondRestore(f, 2);
    const third = await service.prepare(
      f.prior.actor,
      crypto.randomUUID(),
      thirdInput,
    );
    const thirdPlanId = z.uuid().parse(third.nativeRecoveryId);
    await observe(thirdPlanId);
    await files.prepareNativeRecoveryFiles({
      planId: thirdPlanId,
      operationId: z.uuid().parse(third.operationId),
    });
    const thirdApproval = await approve(f, third, thirdInput);
    await observe(thirdPlanId);
    await files.applyNativeRecoveryFiles(thirdApproval);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ state: "published", ownershipEpoch: 3, version: 5 });
    if (added !== null)
      expect(
        await f.db.subtitleAsset.findUniqueOrThrow({
          where: { id: added.subtitleId },
        }),
      ).toMatchObject({
        ownershipEpoch: 3,
        videoVersion: 5,
        version: 3,
        qualityStatus: "accepted",
        forced: true,
        checksum: added.subtitle.checksum,
      });
  },
);

async function negativeHousehold(
  f: Fixture,
  intent: "request" | "no_longer_request" = "no_longer_request",
) {
  for (const user of await f.db.mediaUser.findMany()) {
    const relevant = user.id === f.prior.actor.id || user.id === f.file.user.id;
    const mapping = {
      serverMachineId: "server",
      kind: "account",
      permittedSectionIds: relevant ? ["1"] : ["2"],
      permittedMediaKinds: relevant ? ["movie"] : ["series"],
      plexRestricted: false,
      verifiedAt: new Date(),
    };
    await f.db.plexIdentityMapping.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...mapping },
      update: { ...mapping, version: { increment: 1 } },
    });
  }
  const service = new PrismaRecovery(f.db, "server");
  const prepared = await service.prepare(f.prior.actor, crypto.randomUUID(), {
    mediaIds: [f.file.media.id],
  });
  const id = z.uuid().parse(prepared.recoveryReviewId);
  const detail = await service.detail(f.prior.actor, id);
  expect(detail.scope.blockers).toEqual([]);
  for (const actor of [f.prior.actor, f.file.user])
    await service.respond(actor, crypto.randomUUID(), id, {
      scopeHash: detail.scopeHash,
      declarations: [{ mediaId: f.file.media.id, intent }],
      acknowledgePending: true,
    });
  const reviewed = await service.detail(f.prior.actor, id);
  await service.release(f.prior.actor, crypto.randomUUID(), id, {
    expectedVersion: reviewed.version,
    scopeHash: reviewed.scopeHash,
    responseHash: z.string().parse(reviewed.responseHash),
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
}
