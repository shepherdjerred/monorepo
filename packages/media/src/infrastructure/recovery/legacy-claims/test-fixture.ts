import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { PrismaLegacyRequesterBindings } from "./service.ts";
import { buildRecoveryClaims } from "./projection.ts";
import { claimAccounting } from "./accounting.ts";
import type { RecoveryClaimProjection } from "#shared/recovery-claims.ts";

const number = () => String(crypto.getRandomValues(new Uint32Array(1))[0]);
export function legacyClaimsHarness() {
  const harness = automationTestHarness();
  async function setup() {
    const db = harness.database();
    const owner = await db.mediaUser.create({
      data: {
        plexAccountId: number(),
        displayName: "Binding owner",
        role: "owner",
      },
    });
    const subject = await db.mediaUser.create({
      data: { plexAccountId: number(), displayName: "Signed-in subject" },
    });
    await grantTestRequesterAccess(db, subject.id, "binding-fixture-server");
    await db.mediaRuntimeState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: { recoveryEpoch: 0 },
    });
    const movie = await db.mediaItem.create({
      data: {
        title: "Exact selected movie",
        kind: "movie",
        tmdbId: (Number(number()) % 2_000_000_000) + 1,
      },
    });
    const series = await db.mediaItem.create({
      data: {
        title: "Exact selected series",
        kind: "series",
        tmdbId: (Number(number()) % 2_000_000_000) + 1,
        catalogState: "ready",
      },
    });
    const season = await db.mediaItem.create({
      data: {
        title: "Season one",
        kind: "season",
        parentId: series.id,
        seasonNumber: 1,
      },
    });
    const first = await db.mediaItem.create({
      data: {
        title: "First leaf",
        kind: "episode",
        parentId: season.id,
        seasonNumber: 1,
        episodeNumber: 1,
      },
    });
    const second = await db.mediaItem.create({
      data: {
        title: "Outside leaf",
        kind: "episode",
        parentId: season.id,
        seasonNumber: 1,
        episodeNumber: 2,
      },
    });
    const service = new PrismaLegacyRequesterBindings(
      db,
      "binding-fixture-server",
    );
    const instance = snapshotHash(crypto.randomUUID());
    async function capture(
      input: {
        sourceInstanceId?: string;
        scope?: "movie" | "season" | "series" | "episode";
        requesterSourceId?: string;
        seasons?: number[];
      } = {},
    ) {
      const scope = input.scope ?? "movie";
      const request: MigrationRecord = {
        kind: "request",
        sourceId: crypto.randomUUID(),
        requesterSourceId: input.requesterSourceId ?? "7",
        plexAccountId: null,
        requesterMappingEvidenceHash: null,
        externalIds: {
          tmdb: z
            .number()
            .parse(scope === "movie" ? movie.tmdbId : series.tmdbId),
        },
        scope,
        seasons: input.seasons ?? (scope === "season" ? [1] : []),
        active: true,
      };
      const timestamp = new Date().toISOString();
      const uploaded = await new PrismaMigrationAdministration(db).upload(
        owner,
        {
          snapshot: {
            schemaVersion: 1,
            sourceInstanceId: input.sourceInstanceId ?? instance,
            sourceKind: "seerr",
            sourceVersion: "3.0.0",
            startedAt: timestamp,
            completedAt: timestamp,
            records: [request],
            endpoints: [
              {
                name: "requests",
                pages: 1,
                records: 1,
                complete: true,
                stable: true,
                digest: recordDigest([request]),
                reason: "complete",
              },
            ],
          },
        },
      );
      const captureId = uploaded.captureId;
      return { captureId, request };
    }
    async function bind(
      captureId: string,
      userId = subject.id,
      expectedRevision?: number,
    ) {
      const view = await service.list(owner, captureId);
      const requester = view.requesters[0];
      if (requester === undefined) throw new Error("Missing fixture requester");
      return await service.bind(owner, crypto.randomUUID(), {
        captureId,
        requesterSourceId: requester.requesterSourceId,
        requesterEvidenceHash: requester.requesterEvidenceHash,
        userId,
        expectedRevision: expectedRevision ?? requester.latestRevision,
        acknowledgeIdentityOnly: true,
      });
    }
    async function account(claims: RecoveryClaimProjection[]) {
      const review = await db.recoveryReview.create({
        data: {
          actorId: owner.id,
          recoveryEpoch: 0,
          runtimeVersion: 0,
          scope: { fixture: true },
          scopeHash: snapshotHash(claims),
          expiresAt: new Date(Date.now() + 60_000),
          state: "released",
        },
      });
      return await db.recoveryReleaseReceipt.create({
        data: {
          reviewId: review.id,
          actorId: owner.id,
          recoveryEpoch: 0,
          scopeHash: review.scopeHash,
          responseHash: snapshotHash([]),
          releasedHoldIds: [],
          claimAccounting: claimAccounting(claims),
        },
      });
    }
    const project = (mediaIds: string[]) =>
      buildRecoveryClaims(db, { planIds: [], mediaIds });
    return {
      db,
      owner,
      subject,
      movie,
      series,
      first,
      second,
      season,
      service,
      capture,
      bind,
      account,
      project,
      instance,
    };
  }
  return { setup };
}
