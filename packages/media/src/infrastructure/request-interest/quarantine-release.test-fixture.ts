import { expect } from "vitest";
import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { refreshInterestNoticeReceipts } from "#automation/notifications/interest-receipts.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { PrismaPlaybackHistory } from "#infrastructure/playback/service.ts";
import { PrismaPlaybackCollector } from "#infrastructure/playback/collector.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { RequestInterestCommands } from "./commands.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";
import type { MediaActor } from "#application/auth.ts";
import { reconcileRequestInterests } from "./reconcile.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { elapsedInterestNoticeQueries } from "#automation/retention/fixtures/elapsed.ts";

export type InitialInterestScenario =
  | "finished_manually"
  | "dropped_manually"
  | "lost_interest"
  | "owner_temporary";
const DAY = 86_400_000;

/** A real requester command; callers replay after their own immutable snapshots. */
export async function continueQuarantinedInterest(
  context: Pick<MediaAutomationContext, "db">,
  user: MediaActor,
  mediaId: string,
  edition: MovieEditionKey = "default",
) {
  const request = await context.db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: { userId: user.id, mediaId, edition },
    },
  });
  const commands = new RequestInterestCommands(context.db, { keepDays: 30 });
  const key = crypto.randomUUID();
  const input = {
    schemaVersion: 1 as const,
    requestId: request.id,
    expectedVersion: request.version,
    expectedInterestRevision: request.interestRevision,
    action: "continue" as const,
  };
  const result = await commands.execute(user, key, input);
  expect(result).toMatchObject({
    state: "following",
    version: request.version + 1,
    interestRevision: request.interestRevision + 1,
  });
  return { result, replay: () => commands.execute(user, key, input) };
}

/** Real consent/expiry before warning birth. Only ORIGINAL policy-time writes
 * simulate elapsed days; watch authority, current identities and sessions stay native. */
export async function prepareInitialReleasedInterest(
  context: MediaAutomationContext,
  mediaIds: readonly string[],
  input: { edition?: MovieEditionKey; scenario: InitialInterestScenario },
) {
  const edition = input.edition ?? "default";
  await preparePlaybackOwner(context, input.scenario);
  const requests = await context.db.mediaRequest.findMany({
    where: {
      mediaId: { in: [...mediaIds] },
      edition,
      active: true,
      direct: true,
      excluded: false,
    },
    include: { user: true },
  });
  expect(requests.length).toBeGreaterThan(0);
  for (const mediaId of mediaIds)
    expect(await observeRequesterWatch(context, mediaId, { edition })).toEqual({
      complete: true,
      reason: null,
    });
  if (input.scenario === "owner_temporary") {
    await prepareOwnerTemporary(context, requests, edition);
    return;
  }
  const policyDb = elapsedInterestPolicy(context, mediaIds);
  const policy = { ...context, db: policyDb };
  for (const request of requests) {
    expect(request).toMatchObject({
      interestState: "following",
      keepingPolicy: "temporary",
    });
    if (input.scenario === "lost_interest") {
      await context.db.mediaRequest.update({
        where: { id: request.id },
        data: {
          interestRenewedAt: new Date(Date.now() - 48 * DAY),
          usableUnwatchedSince: new Date(Date.now() - 48 * DAY),
        },
      });
      const predecessor = await context.db.mediaRequest.findFirst({
        where: { id: { lt: request.id } },
        orderBy: { id: "desc" },
        select: { id: true },
      });
      expect(
        await reconcileRequestInterests(policyDb, {
          cursor: predecessor?.id ?? null,
        }),
      ).toMatchObject({ processed: 1, nextCursor: request.id });
      const noticed = await context.db.mediaRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      const eventId = z.uuid().parse(noticed.interestNoticeEventId);
      const delivery = await context.db.notificationDelivery.findFirstOrThrow({
        where: {
          eventId,
          userId: request.userId,
          channel: { in: ["email", "discord"] },
        },
      });
      const command = await context.db.operation.findFirstOrThrow({
        where: { kind: "deliver_notification", targetId: delivery.id },
      });
      expect(
        await createNotificationActivities(policy).deliverMediaNotification({
          operationId: command.id,
          notificationId: delivery.id,
        }),
      ).toMatchObject({ status: "accepted" });
      expect(await refreshInterestNoticeReceipts(policy, eventId)).toBe(true);
      await reconcileRequestInterests(policyDb, {
        cursor: predecessor?.id ?? null,
      });
    } else {
      await new RequestInterestCommands(policyDb, { keepDays: 30 }).execute(
        request.user,
        crypto.randomUUID(),
        {
          schemaVersion: 1,
          requestId: request.id,
          expectedVersion: request.version,
          expectedInterestRevision: request.interestRevision,
          action: input.scenario === "finished_manually" ? "finished" : "drop",
        },
      );
    }
    expect(
      await context.db.mediaRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({
      interestState:
        input.scenario === "lost_interest"
          ? "expired"
          : input.scenario === "finished_manually"
            ? "finished"
            : "dropped",
      interestReleaseReason: input.scenario,
    });
  }
  if (input.scenario === "lost_interest") await readyEmptyPlayback(context);
}

/** A separate configured owner authenticates history handoff; no requester is promoted. */
async function preparePlaybackOwner(
  context: MediaAutomationContext,
  scenario: InitialInterestScenario,
) {
  if (scenario !== "lost_interest") return;
  const existing = await context.db.mediaUser.findFirst({
    where: { role: "owner", restricted: false },
  });
  if (existing !== null) return;
  const serverMachineId = context.serverMachineId;
  if (serverMachineId === undefined)
    throw new Error("Native playback fixture lacks its server identity");
  const auth = new PrismaAuthStore(context.db);
  const now = new Date(),
    expiresAt = new Date(now.getTime() + 60_000);
  const loginId = crypto.randomUUID(),
    ownerAccountId = "710099000002";
  await auth.saveLogin({
    id: loginId,
    pinId: 1,
    pinCode: "synthetic-quarantine-owner",
    browserHash: "synthetic-quarantine-owner",
    expiresAt,
    encryptedDevice: "synthetic-unused-device",
  });
  await auth.completeLogin({
    loginId,
    now,
    accountId: ownerAccountId,
    ownerAccountId,
    displayName: "Synthetic quarantine history owner",
    encryptedCredential: context.cipher.encrypt(
      JSON.stringify({ token: "synthetic-quarantine-owner-token" }),
      `plex:${ownerAccountId}`,
    ),
    access: {
      accountId: ownerAccountId,
      serverMachineId,
      permittedSectionIds: [],
      permittedMediaKinds: [],
      plexRestricted: false,
    },
    sessionId: crypto.randomUUID(),
    csrfHash: "synthetic-quarantine-owner",
    expiresAt,
  });
}

async function prepareOwnerTemporary(
  context: MediaAutomationContext,
  requests: {
    id: string;
    mediaId: string;
    userId: string;
    version: number;
    user: MediaActor;
  }[],
  edition: MovieEditionKey,
) {
  if (edition !== "default")
    throw new Error(
      "Owner Temporary fixture uses the ordinary default protocol",
    );
  for (const request of requests)
    await new MediaRequestCommands(context.db, { keepDays: 30 }).cancelRequest(
      request.user,
      crypto.randomUUID(),
      request.id,
      request.version,
    );
  const owner = await context.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Synthetic library policy owner",
      role: "owner",
      email: `${crypto.randomUUID()}@policy.fixture`,
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const first = requests[0];
  if (first === undefined)
    throw new Error("Owner Temporary fixture lost its original requester");
  const mapping = await context.db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: first.userId },
  });
  await context.db.plexIdentityMapping.create({
    data: {
      ...mapping,
      userId: owner.id,
      serverAccountId: owner.plexAccountId,
      homeUserId: null,
    },
  });
  await context.db.credential.create({
    data: {
      userId: owner.id,
      kind: "plex",
      ciphertext: context.cipher.encrypt(
        JSON.stringify({ serverToken: "synthetic-policy-owner" }),
        `plex:${owner.plexAccountId}`,
      ),
    },
  });
  for (const request of requests) {
    const media = await context.db.mediaItem.findUniqueOrThrow({
      where: { id: request.mediaId },
    });
    const target = await context.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: request.mediaId, edition } },
    });
    await new RequestInterestCommands(context.db, {
      keepDays: 30,
    }).libraryPolicy(owner, crypto.randomUUID(), {
      schemaVersion: 1,
      mediaId: request.mediaId,
      edition,
      expectedMediaVersion: media.version,
      expectedTargetVersion: target.version,
      keepingPolicy: "temporary",
    });
    expect(await observeRequesterWatch(context, request.mediaId)).toEqual({
      complete: true,
      reason: null,
    });
  }
}

function elapsedInterestPolicy(
  context: MediaAutomationContext,
  mediaIds: readonly string[],
) {
  const ids = new Set(mediaIds),
    events = new Set<string>();
  const noticeAt = new Date(Date.now() - 17 * DAY),
    releaseAt = new Date(Date.now() - 9 * DAY);
  return queryFixtureDatabase(context.db, {
    query: {
      ...elapsedInterestNoticeQueries(events, noticeAt),
      mediaRequest: {
        async update({ args, query }) {
          if (args.data.interestReleasedAt instanceof Date) {
            args.data.interestReleasedAt = releaseAt;
            if (args.data.interestRenewedAt instanceof Date)
              args.data.interestRenewedAt = releaseAt;
          }
          return query(args);
        },
      },
      applicationEvent: {
        async create({ args, query }) {
          const selected =
            args.data.mediaId !== undefined &&
            args.data.mediaId !== null &&
            ids.has(args.data.mediaId);
          if (selected && args.data.kind === "interest_check")
            args.data.createdAt = noticeAt;
          if (
            selected &&
            ["request_interest_changed", "request_interest_released"].includes(
              args.data.kind,
            )
          )
            args.data.createdAt = releaseAt;
          const row = await query(args);
          if (selected && args.data.kind === "interest_check")
            events.add(z.uuid().parse(row.id));
          return row;
        },
      },
    },
  });
}

async function readyEmptyPlayback(context: MediaAutomationContext) {
  const server = context.serverMachineId;
  if (server === undefined)
    throw new Error("Native fixture requires its actual Plex server");
  const checkpoint = await context.db.playbackCollector.findUnique({
    where: { serverMachineId: server },
  });
  const now = new Date(),
    through = checkpoint?.importedThrough?.toISOString() ?? now.toISOString();
  if (checkpoint?.collectionStartedAt == null) {
    const owner = await context.db.mediaUser.findFirstOrThrow({
      where: { role: "owner", restricted: false },
    });
    const sourceInstanceId =
      checkpoint?.importSourceInstanceId ?? "synthetic-quarantine-history";
    const history = new PrismaPlaybackHistory(
      context.db,
      { serverMachineId: server },
      () => now,
      () =>
        Promise.resolve({
          capturedAt: new Date(through),
          expiresAt: new Date(now.getTime() + 60_000),
          inventoryDigest: "synthetic-stopped-quarantine-inventory",
        }),
    );
    await history.importHistory(owner, {
      sourceInstanceId,
      serverMachineId: server,
      through,
      rows: [],
      userBindings: [],
    });
    const current = await context.db.playbackCollector.findUniqueOrThrow({
      where: { serverMachineId: server },
    });
    await history.sealHandoff(owner, {
      sourceInstanceId,
      through,
      expectedVersion: current.version,
      expectedSessions: 0,
      snapshotDigest: snapshotHash([]),
      quiescenceCapturedAt: through,
      inventoryDigest: "synthetic-stopped-quarantine-inventory",
    });
  }
  await new PrismaPlaybackCollector(
    context.db,
    { sessions: () => Promise.resolve([]) },
    server,
  ).reconcile();
}
