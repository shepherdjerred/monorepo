import { afterAll, beforeAll, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import { CredentialCipher } from "#application/security.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { removalNoticeAcceptance } from "#infrastructure/request-interest/notice-proof.ts";
import { NotificationDeliveryCommands } from "./commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
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
  await grantTestLease(db);
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  const member = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Recipient",
    },
  });
  const media = await db.mediaItem.create({
    data: { kind: "series", title: "Finished temporary show" },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [{ mediaId: media.id, edition: "default" }], {
      createMissing: true,
    }),
  );
  const request = await db.mediaRequest.create({
    data: {
      userId: member.id,
      mediaId: media.id,
      keepingPolicy: "temporary",
    },
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
  const decision = await db.retentionDecision.create({
    data: {
      mediaId: media.id,
      generation: intent.generation,
      state: "warning_pending",
      evidence: {},
    },
  });
  const event = await db.applicationEvent.create({
    data: {
      mediaId: media.id,
      kind: "retention_warning",
      payload: { decisionId: decision.id, generation: intent.generation },
    },
  });
  await db.retentionDecision.update({
    where: { id: decision.id },
    data: {
      evidence: { warningEventId: event.id, recoveryEpoch: 0 },
    },
  });
  const delivery = await db.notificationDelivery.create({
    data: {
      eventId: event.id,
      userId: member.id,
      channel: "in_app",
      state: "pending",
      recoveryEpoch: 0,
    },
  });
  const commands = new NotificationDeliveryCommands(
    db,
    new CredentialCipher(randomBytes(32).toString("base64")),
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
