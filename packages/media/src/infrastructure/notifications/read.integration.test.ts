import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import {
  observeRequesterWatch,
  queueRetentionCheck,
} from "#automation/watch.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { removalNoticeAcceptance } from "#infrastructure/request-interest/notice-proof.ts";
import { NotificationDeliveryCommands } from "./commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
});
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

async function fixture() {
  const db = cluster.database;
  const files = await mappedPublicationFixture(db);
  directories.push(files.directory);
  const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
  const published = await preparePhysicalPublication(files);
  const transport = await retentionPlexContext(
    db,
    createAutomationTestContext(db, cipher),
    [files.media.id],
  );
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  const member = files.user;
  const media = files.media;
  await db.credential.create({
    data: {
      userId: member.id,
      kind: "plex",
      ciphertext: cipher.encrypt(
        JSON.stringify({ serverToken: `synthetic-requester:${member.id}` }),
        `plex:${member.plexAccountId}`,
      ),
    },
  });
  const publication = createPublicationActivities(transport.context);
  expect(await publication.publishMediaToPlex(published.input)).toEqual({
    status: "available",
    reason: null,
  });
  await publication.finalizeMediaAcquisition(published.input);
  expect(await observeRequesterWatch(transport.context, media.id)).toEqual({
    complete: true,
    reason: null,
  });
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: files.request.id },
  });
  const interestCommands = new RequestInterestCommands(db, { keepDays: 30 });
  await interestCommands.execute(member, crypto.randomUUID(), {
    schemaVersion: 1,
    requestId: request.id,
    expectedVersion: request.version,
    expectedInterestRevision: request.interestRevision,
    action: "finished",
  });
  const intent = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: media.id, edition: "default" },
    },
  });
  const bucket = `reminder-fixture:${crypto.randomUUID()}`;
  await queueRetentionCheck(transport.context, media.id, bucket);
  const operation = await db.operation.findUniqueOrThrow({
    where: {
      idempotencyKey: `retention:${media.id}:${String(intent.generation)}:${bucket}`,
    },
  });
  const warning = await createRetentionActivities(
    transport.context,
  ).evaluateMediaRetention(
    z
      .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
      .parse(operation.payload),
  );
  expect(warning).toMatchObject({ status: "warning" });
  const decision = await db.retentionDecision.findUniqueOrThrow({
    where: { id: z.uuid().parse(warning.decisionId) },
  });
  const event = await db.applicationEvent.findUniqueOrThrow({
    where: {
      id: z.object({ warningEventId: z.uuid() }).parse(decision.evidence)
        .warningEventId,
    },
  });
  const delivery = await db.notificationDelivery.findFirstOrThrow({
    where: { eventId: event.id, userId: member.id, channel: "in_app" },
  });
  expect(intent.automationEpoch).toBe(delivery.recoveryEpoch);
  expect(
    await db.retentionPlexProjection.count({
      where: { decisionId: decision.id },
    }),
  ).toBe(1);
  expect(delivery).toMatchObject({ state: "pending", acceptedAt: null });
  const commands = new NotificationDeliveryCommands(
    db,
    cipher,
    "https://media.fixture",
  );
  return {
    db,
    owner,
    member,
    media,
    intent,
    event,
    delivery,
    commands,
    interestCommands,
  };
}

test("a displayed reminder cannot start removal grace until the recipient explicitly acknowledges it", async () => {
  const f = await fixture();
  const accepted = () =>
    f.db.notificationDelivery.count({
      where: {
        eventId: f.event.id,
        ...removalNoticeAcceptance(new Date()),
      },
    });
  expect(await accepted()).toBe(0);
  const key = crypto.randomUUID();
  const result = await f.commands.acknowledgeRead(
    f.member,
    key,
    f.delivery.id,
    f.delivery.version,
  );
  expect(await accepted()).toBe(1);
  expect(
    await f.commands.acknowledgeRead(
      f.member,
      key,
      f.delivery.id,
      f.delivery.version,
    ),
  ).toEqual(result);
  expect(
    await f.db.applicationEvent.count({
      where: { mediaId: f.media.id, kind: "notification_viewed" },
    }),
  ).toBe(1);
  expect(
    await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: f.delivery.id },
    }),
  ).toMatchObject({
    state: "accepted",
    providerStatus: "viewed",
    version: f.delivery.version + 1,
  });
});

test("another household member and a stale reminder version cannot acknowledge a recipient's notice", async () => {
  const f = await fixture();
  await expect(
    f.commands.acknowledgeRead(
      f.owner,
      crypto.randomUUID(),
      f.delivery.id,
      f.delivery.version,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    f.commands.acknowledgeRead(
      f.member,
      crypto.randomUUID(),
      f.delivery.id,
      f.delivery.version + 1,
    ),
  ).rejects.toMatchObject({ code: "version_conflict" });
  expect(
    await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: f.delivery.id },
    }),
  ).toMatchObject({ state: "pending", acceptedAt: null });
});

test("a new permanent Keep invalidates an old in-app removal reminder", async () => {
  const f = await fixture();
  const currentMedia = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: f.media.id },
  });
  await f.interestCommands.libraryPolicy(f.owner, crypto.randomUUID(), {
    schemaVersion: 1,
    mediaId: f.media.id,
    edition: "default",
    expectedMediaVersion: currentMedia.version,
    expectedTargetVersion: f.intent.version,
    keepingPolicy: "keep",
  });
  await expect(
    f.commands.acknowledgeRead(
      f.member,
      crypto.randomUUID(),
      f.delivery.id,
      f.delivery.version,
    ),
  ).rejects.toMatchObject({ code: "notice_obsolete" });
  expect(
    await f.db.notificationDelivery.count({
      where: {
        eventId: f.event.id,
        ...removalNoticeAcceptance(new Date()),
      },
    }),
  ).toBe(0);
});

test("revoked runtime authority cannot accept a notice or invent a provider receipt", async () => {
  const f = await fixture();
  await f.db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: { revokedAt: new Date() },
  });
  await expect(
    f.commands.acknowledgeRead(
      f.member,
      crypto.randomUUID(),
      f.delivery.id,
      f.delivery.version,
    ),
  ).rejects.toMatchObject({ code: "notice_obsolete" });
  expect(
    await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: f.delivery.id },
    }),
  ).toMatchObject({ state: "pending", acceptedAt: null, providerStatus: null });
});
