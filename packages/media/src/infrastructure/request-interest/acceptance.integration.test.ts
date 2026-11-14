import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { noticeAcceptance } from "./acceptance.ts";
import { RequestInterestCommands } from "./commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

async function fixture(patch: Record<string, string | number> = {}) {
  const db = cluster.database;
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Private requester",
    },
  });
  const media = await db.mediaItem.create({
    data: { kind: "series", title: "Notice subject" },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [{ mediaId: media.id, edition: "default" }], {
      createMissing: true,
    }),
  );
  const request = await db.mediaRequest.create({
    data: { mediaId: media.id, userId: user.id, interestRevision: 3 },
  });
  const event = await db.applicationEvent.create({
    data: {
      mediaId: media.id,
      kind: "interest_check",
      payload: {
        schemaVersion: 1,
        requestId: request.id,
        userId: user.id,
        mediaId: media.id,
        edition: "default",
        interestRevision: 3,
        ...patch,
      },
    },
  });
  await db.mediaRequest.update({
    where: { id: request.id },
    data: { interestNoticeEventId: event.id, interestNoticeRevision: 3 },
  });
  const read = async (now = new Date()) =>
    db.$transaction(async (tx) =>
      noticeAcceptance(
        tx,
        await tx.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
        now,
      ),
    );
  const receipt = (
    receiptPatch: {
      userId?: string;
      channel?: string;
      state?: string;
      providerStatus?: string;
      acceptedAt?: Date;
      reconciledAt?: Date;
    } = {},
  ) =>
    db.notificationDelivery.create({
      data: {
        eventId: event.id,
        userId: user.id,
        channel: "email",
        state: "accepted",
        acceptedAt: new Date(),
        reconciledAt: new Date(),
        providerStatus: "delivered",
        ...receiptPatch,
      },
    });
  return { db, user, media, request, event, read, receipt };
}

test.each([
  ["wrong requester", { userId: "00000000-0000-4000-8000-000000000001" }],
  ["wrong request", { requestId: "00000000-0000-4000-8000-000000000002" }],
  ["wrong media", { mediaId: "00000000-0000-4000-8000-000000000003" }],
  ["wrong edition", { edition: "directors_cut" }],
  ["wrong revision", { interestRevision: 2 }],
] as const)(
  "%s notice cannot start expiry even with a delivered receipt",
  async (_label, patch) => {
    const f = await fixture(patch);
    await f.receipt();
    expect(await f.read()).toBeNull();
  },
);

test.each([
  "missing",
  "stale",
  "bounced",
  "pending",
  "public",
  "before_event",
  "future",
  "other_recipient",
] as const)("%s private receipt cannot start expiry", async (kind) => {
  const f = await fixture();
  const now = new Date();
  const other = await f.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Another member",
    },
  });
  const variants = {
    missing: {},
    stale: { reconciledAt: new Date(now.getTime() - 60_001) },
    bounced: { providerStatus: "bounced" },
    pending: { state: "pending" },
    public: { channel: "discord_public" },
    before_event: { acceptedAt: new Date(f.event.createdAt.getTime() - 1) },
    future: { acceptedAt: new Date(now.getTime() + 86_400_000) },
    other_recipient: { userId: other.id },
  };
  if (kind !== "missing") await f.receipt(variants[kind]);
  expect(await f.read()).toBeNull();
});

test("current exact private delivery is accepted, while renewed revision invalidates it", async () => {
  const f = await fixture();
  const receipt = await f.receipt();
  expect(await f.read()).toEqual(receipt.acceptedAt);
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { interestRevision: { increment: 1 } },
  });
  expect(await f.read()).toBeNull();
});

test("a genuine explicit requester acknowledgement accepts only the current exact notice", async () => {
  const f = await fixture();
  const commands = new RequestInterestCommands(f.db, { keepDays: 30 });
  const current = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: f.request.id },
  });
  await commands.execute(f.user, crypto.randomUUID(), {
    schemaVersion: 1,
    requestId: current.id,
    expectedVersion: current.version,
    expectedInterestRevision: current.interestRevision,
    action: "notice_viewed",
    noticeEventId: f.event.id,
  });
  expect(await f.read()).toBeInstanceOf(Date);
});

test("a viewed timestamp preceding the notice is not acceptance", async () => {
  const f = await fixture();
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { interestNoticeViewedAt: new Date(f.event.createdAt.getTime() - 1) },
  });
  expect(await f.read()).toBeNull();
});
