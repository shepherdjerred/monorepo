import { randomBytes } from "node:crypto";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import { grantTestLease } from "#testing/authority.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { sweepFeeds } from "#automation/reconciliation/feeds.ts";
import { matchProviderFeedSourceV1 } from "#automation/feeds/matching.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { MatchFeedSourceV1Schema } from "#shared/feeds/contract.ts";

/** Actual native reader, PG, reviewed consent and outbox; remote HTTP and writer attestations are synthetic. */
export async function createProviderFeedWorkerFixture() {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  try {
    const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
    const context = createAutomationTestContext(db, cipher);
    await grantTestLease(db);
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true },
    });
    const user = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Synthetic requester",
        role: "member",
      },
    });
    await db.plexIdentityMapping.create({
      data: {
        userId: user.id,
        serverMachineId: "fixture-server",
        serverAccountId: user.plexAccountId,
        kind: "account",
        permittedSectionIds: ["1"],
        permittedMediaKinds: ["movie"],
        verifiedAt: new Date(),
      },
    });
    const rules = {
      qualities: ["WEB-1080p"],
      rejectedCodecs: [],
      requiredAudioLanguages: [],
      minimumBytes: 1,
      maximumBytes: 1_000_000,
      minimumScore: 0,
      tagScores: {},
      cutoffQuality: "WEB-1080p",
      cutoffScore: 0,
    };
    const profile = await db.qualityProfile.create({
      data: {
        name: "Synthetic feed quality",
        rules,
        versions: { create: { version: 0, rules } },
      },
    });
    await db.qualityProfileDefault.create({
      data: { kind: "movie", profileId: profile.id },
    });
    const media = await db.mediaItem.create({
      data: { kind: "movie", title: "Feed Fixture", year: 2020 },
    });
    await chooseTestMovieEdition(db, {
      actor: user,
      mediaId: media.id,
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
    });
    await db.mediaProvider.create({ data: { id: "knaben", enabled: true } });
    const native = new KnabenProvider((url) => {
      if (url.pathname !== "/v2/browse")
        throw new Error("Expected the actual recent listing endpoint");
      return Promise.resolve(
        Response.json({
          hits: [
            {
              id: "synthetic-feed",
              title: "Feed.Fixture.2020.WEB-DL.1080p",
              bytes: 1000,
              hash: "a".repeat(40),
              seeders: 2,
              details: "https://knaben.org/fixture",
              magnetUrl: null,
            },
          ],
        }),
      );
    });
    context.providers = { withProvider: (_id, work) => work(native) };
    await sweepFeeds(context, null, crypto.randomUUID());
    const operation = await db.operation.findFirstOrThrow({
      where: { kind: "match_provider_feed_source_v1" },
    });
    const input = MatchFeedSourceV1Schema.parse(
      z.object(MatchFeedSourceV1Schema.shape).parse(operation.payload),
    );
    const finish = createOutboxActivities(db, () =>
      Promise.reject(new Error("No dispatch from completion")),
    );
    return {
      input,
      close: () => cluster.close(),
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(db, start).dispatchMediaOutbox(),
      matchProviderFeedSource: (value: typeof input) =>
        matchProviderFeedSourceV1(context, value),
      finishMediaOperation: finish.finishMediaOperation,
      evidence: async () => ({
        operation: await db.operation.findUniqueOrThrow({
          where: { id: input.operationId },
          include: { outbox: true },
        }),
        queued: await db.operation.findMany({
          where: {
            targetId: media.id,
            idempotencyKey: {
              startsWith: `feed-acquire-v1:${input.sourceId}:`,
            },
          },
          include: { outbox: true },
        }),
        attempts: await db.acquisitionAttempt.count(),
        torrents: await db.torrent.count(),
      }),
    };
  } catch (error) {
    await cluster.close();
    throw error;
  }
}
