import { afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { elapsedQuarantineClient } from "#automation/retention/fixtures/elapsed-quarantine.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import { releaseInput } from "#infrastructure/recovery/test-support.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { RecoveryScopeV2Schema } from "#shared/recovery.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { PrismaLegacyRequesterBindings } from "./service.ts";
import { chooseCurrentTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";

export function legacyLifecycleHarness() {
  const harness = automationTestHarness();
  const directories: string[] = [];
  afterAll(async () => {
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  });
  async function fixture() {
    const db = harness.database();
    const f = await mappedPublicationFixture(db);
    directories.push(f.directory);
    const owner = await db.mediaUser.create({
      data: {
        plexAccountId: String(crypto.getRandomValues(new Uint32Array(1))[0]),
        displayName: "Lifecycle owner",
        role: "owner",
      },
    });
    const user = await db.mediaUser.update({
      where: { id: f.user.id },
      data: {
        plexAccountId: String(crypto.getRandomValues(new Uint32Array(1))[0]),
      },
    });
    for (const actor of [owner, user])
      await grantTestRequesterAccess(db, actor.id, "fixture-server");
    await db.mediaItem.update({
      where: { id: f.media.id },
      data: { externalIds: { plexSectionId: "1" } },
    });
    await db.recoveryHold.create({
      data: {
        mediaId: f.media.id,
        recoveryEpoch: 0,
        reason: "recovery_request_history_unconfirmed",
      },
    });
    const recovery = new PrismaRecovery(db, "fixture-server");
    async function release() {
      const result = await recovery.prepare(owner, crypto.randomUUID(), {
        mediaIds: [f.media.id],
      });
      const review = await recovery.detail(
        owner,
        z.uuid().parse(result.recoveryReviewId),
      );
      const scope = RecoveryScopeV2Schema.parse(review.scope);
      if (scope.blockers.length > 0)
        throw new Error(JSON.stringify(scope.blockers));
      for (const subject of scope.users) {
        const actor = await db.mediaUser.findUniqueOrThrow({
          where: { id: subject.id },
        });
        await recovery.respond(actor, crypto.randomUUID(), review.id, {
          scopeHash: review.scopeHash,
          acknowledgePending: true,
          claimAcknowledgements: subject.claimAcknowledgements,
          declarations: [
            {
              mediaId: f.media.id,
              intent: actor.id === user.id ? "request" : "no_longer_request",
            },
          ],
        });
      }
      const ready = await recovery.detail(owner, review.id);
      return await recovery.release(
        owner,
        crypto.randomUUID(),
        review.id,
        releaseInput(ready),
      );
    }
    await release();
    await chooseCurrentTestMovieEdition(db, {
      requestId: f.request.id,
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
    });
    const published = await preparePhysicalPublication(f);
    const bound = await prepareBoundRetention(f, published, harness.context());
    const retention = bound.retention;
    const quarantineTiming = await elapsedQuarantineClient(
      db,
      retention.decision.id,
    );
    f.context.db = quarantineTiming.db;
    async function bind(captureId: string) {
      const bindings = new PrismaLegacyRequesterBindings(db, "fixture-server");
      const view = await bindings.list(owner, captureId);
      const requester = view.requesters[0];
      if (requester === undefined) throw new Error("Missing fixture requester");
      await bindings.bind(owner, crypto.randomUUID(), {
        captureId,
        requesterSourceId: requester.requesterSourceId,
        requesterEvidenceHash: requester.requesterEvidenceHash,
        userId: user.id,
        expectedRevision: requester.latestRevision,
        acknowledgeIdentityOnly: true,
      });
    }
    async function capture(mapped: boolean) {
      const record: MigrationRecord = {
        kind: "request",
        sourceId: "late-request",
        requesterSourceId: "7",
        plexAccountId: null,
        requesterMappingEvidenceHash: null,
        externalIds: { tmdb: z.number().parse(f.media.tmdbId) },
        scope: "movie",
        seasons: [],
        active: true,
      };
      const timestamp = new Date().toISOString();
      const result = await new PrismaMigrationAdministration(db).upload(owner, {
        snapshot: {
          schemaVersion: 1,
          sourceKind: "seerr",
          sourceInstanceId: snapshotHash(crypto.randomUUID()),
          sourceVersion: "3.0.0",
          startedAt: timestamp,
          completedAt: timestamp,
          records: [record],
          endpoints: [
            {
              name: "requests",
              pages: 1,
              records: 1,
              complete: true,
              stable: true,
              reason: "complete",
              digest: recordDigest([record]),
            },
          ],
        },
      });
      if (mapped) await bind(result.captureId);
      return result.captureId;
    }
    async function refresh() {
      await bound.observe(true);
      await bound.refresh();
    }
    return {
      ...f,
      db,
      owner,
      user,
      published,
      retention,
      recovery,
      capture,
      bind,
      release,
      refresh,
      assertQuarantineAge: quarantineTiming.assertWritten,
      network: bound.context,
    };
  }
  return { fixture };
}
