import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { RequestInterestCommands } from "./commands.ts";
import { listRequestInterests } from "./read.ts";
import { householdRetentionState } from "./protection.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { requestKeepingPolicy } from "./policy.ts";
import { composeInterestCheck } from "#automation/notifications/interest-check.ts";
import { deliveryInclude } from "#automation/notifications/message.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";
import { reconcileRequestInterests } from "./reconcile.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

async function fixture() {
  const db = cluster.database;
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
      displayName: "Member",
      email: "fixture@example.com",
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Kept show" },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "An episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  await db.$transaction(async (tx) =>
    lockDefaultScopes(
      tx,
      [
        { mediaId: series.id, edition: "default" },
        { mediaId: episode.id, edition: "default" },
      ],
      { createMissing: true },
    ),
  );
  const request = await db.mediaRequest.create({
    data: { mediaId: series.id, userId: member.id, keepingPolicy: "temporary" },
  });
  const commands = new RequestInterestCommands(db, { keepDays: 30 });
  const input = (
    action:
      "continue" | "finished" | "drop" | "keep" | "temporary" | "notice_viewed",
  ) => ({
    schemaVersion: 1 as const,
    requestId: request.id,
    expectedVersion: request.version,
    expectedInterestRevision: request.interestRevision,
    action,
  });
  return { db, owner, member, series, episode, request, commands, input };
}

test("owner must choose a keeping policy; members cannot grant permanent Keep", async () => {
  const f = await fixture();
  expect(() => requestKeepingPolicy(f.owner, undefined)).toThrow(
    "Choose Keep indefinitely or Temporary",
  );
  expect(requestKeepingPolicy(f.member, undefined)).toBe("temporary");
  expect(() => requestKeepingPolicy(f.member, "keep")).toThrow(
    "Only the owner",
  );
});

test("a following root protects every episode before coverage expansion", async () => {
  const f = await fixture();
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: "requester_still_following" });
  expect(
    await f.db.requestCoverage.count({
      where: { rootRequestId: f.request.id },
    }),
  ).toBe(0);
});

test("Finished releases acquisition authority while retaining the request history", async () => {
  const f = await fixture();
  const result = await f.commands.execute(
    f.member,
    crypto.randomUUID(),
    f.input("finished"),
  );
  expect(result).toMatchObject({
    state: "finished",
    interestRevision: 1,
    version: 1,
  });
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: f.request.id },
  });
  expect(request).toMatchObject({
    active: true,
    direct: true,
    excluded: false,
    interestState: "finished",
    interestReleaseReason: "finished_manually",
  });
  expect(
    await f.db.mediaRequest.count({
      where: { id: f.request.id, ...effectiveRequestWhere },
    }),
  ).toBe(0);
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: null });
  const listed = await listRequestInterests(f.db, f.member, null);
  expect(
    listed.items.some(
      (item) =>
        item.requestId === request.id && item.interestState === "finished",
    ),
  ).toBe(true);
});

test("another interested requester protects shared episodes after one finishes", async () => {
  const f = await fixture();
  const other = await f.db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Other" },
  });
  await f.db.mediaRequest.create({
    data: { mediaId: f.series.id, userId: other.id },
  });
  await f.commands.execute(f.member, crypto.randomUUID(), f.input("finished"));
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: "requester_still_following" });
});

test("commands replay exactly once and stale Keep watching cannot overwrite a newer choice", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const result = await f.commands.execute(f.member, key, f.input("drop"));
  expect(await f.commands.execute(f.member, key, f.input("drop"))).toEqual(
    result,
  );
  await expect(
    f.commands.execute(f.member, crypto.randomUUID(), f.input("continue")),
  ).rejects.toMatchObject({ code: "version_conflict" });
  expect(
    await f.db.applicationEvent.count({
      where: { mediaId: f.series.id, kind: "request_interest_changed" },
    }),
  ).toBe(1);
});

test("members cannot change other interests or permanent library policy", async () => {
  const f = await fixture();
  const other = await f.db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Other" },
  });
  await expect(
    f.commands.execute(other, crypto.randomUUID(), f.input("finished")),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    f.commands.execute(f.member, crypto.randomUUID(), f.input("keep")),
  ).rejects.toMatchObject({ code: "owner_required" });
});

test("a migrated Keep is inherited and owner Temporary changes the whole tree synchronously", async () => {
  const f = await fixture();
  await f.db.mediaIntent.updateMany({
    where: { mediaId: { in: [f.series.id, f.episode.id] } },
    data: { libraryKeep: true },
  });
  await f.commands.execute(f.member, crypto.randomUUID(), f.input("finished"));
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: "library_kept_indefinitely" });
  const media = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: f.series.id },
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
  });
  await f.commands.libraryPolicy(f.owner, crypto.randomUUID(), {
    schemaVersion: 1,
    mediaId: media.id,
    edition: "default",
    expectedMediaVersion: media.version,
    expectedTargetVersion: target.version,
    keepingPolicy: "temporary",
  });
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: null });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ libraryKeep: true, libraryPolicyExplicit: false });
});

test("a more specific explicit Keep remains protective beneath temporary series policy", async () => {
  const f = await fixture();
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: {
      libraryKeep: false,
      libraryPolicyExplicit: true,
      libraryPolicyActorId: f.owner.id,
    },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: {
      libraryKeep: true,
      libraryPolicyExplicit: true,
      libraryPolicyActorId: f.owner.id,
    },
  });
  await f.commands.execute(f.member, crypto.randomUUID(), f.input("finished"));
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: "library_kept_indefinitely" });
});

test("an explicit whole-series Keep protects a leaf even when its owner policy is Temporary", async () => {
  const f = await fixture();
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: {
      libraryKeep: true,
      libraryPolicyExplicit: true,
      libraryPolicyActorId: f.owner.id,
    },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: {
      libraryKeep: false,
      libraryPolicyExplicit: true,
      libraryPolicyActorId: f.owner.id,
    },
  });
  await f.commands.execute(f.member, crypto.randomUUID(), f.input("finished"));
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: "library_kept_indefinitely" });
});

test("a requestless explicit Temporary policy retains the real current owner as warning recipient", async () => {
  const f = await fixture();
  const movie = await f.db.mediaItem.create({
    data: { kind: "movie", title: "Imported movie" },
  });
  await f.db.$transaction((tx) =>
    lockDefaultScopes(tx, [{ mediaId: movie.id, edition: "default" }], {
      createMissing: true,
    }),
  );
  await f.commands.libraryPolicy(f.owner, crypto.randomUUID(), {
    schemaVersion: 1,
    mediaId: movie.id,
    edition: "default",
    expectedMediaVersion: 0,
    expectedTargetVersion: 0,
    keepingPolicy: "temporary",
  });
  const policy = await f.db.$transaction((tx) =>
    householdRetentionState(tx, movie.id),
  );
  expect(policy.reason).toBe(null);
  expect(policy.roots).toHaveLength(0);
  expect(policy.recipients.map((recipient) => recipient.userId)).toEqual([
    f.owner.id,
  ]);
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member" },
  });
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, movie.id)),
  ).toMatchObject({ reason: "owner_only_or_unclaimed" });
});

test("restricted users retain personal protective controls without household read privilege", async () => {
  const f = await fixture();
  await f.db.mediaUser.update({
    where: { id: f.member.id },
    data: { restricted: true, role: "owner" },
  });
  const own = await listRequestInterests(
    f.db,
    { ...f.member, role: "owner" },
    null,
  );
  expect(own.items.every((request) => request.userId === f.member.id)).toBe(
    true,
  );
  await expect(
    f.commands.execute(f.member, crypto.randomUUID(), f.input("continue")),
  ).resolves.toMatchObject({ state: "following" });
});

async function noticeFixture() {
  const f = await fixture();
  const event = await f.db.applicationEvent.create({
    data: {
      mediaId: f.series.id,
      kind: "interest_check",
      payload: InterestCheckNoticeSchema.parse({
        schemaVersion: 1,
        requestId: f.request.id,
        userId: f.member.id,
        mediaId: f.series.id,
        edition: "default",
        interestRevision: 0,
      }),
    },
  });
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { interestNoticeEventId: event.id, interestNoticeRevision: 0 },
  });
  const row = await f.db.notificationDelivery.create({
    data: {
      eventId: event.id,
      userId: f.member.id,
      channel: "email",
      state: "pending",
    },
    include: deliveryInclude,
  });
  return { ...f, event, row };
}

test("private check-in composition is revision-bound and links never mutate interest", async () => {
  const f = await noticeFixture();
  const message = await f.db.$transaction((tx) =>
    composeInterestCheck(tx, "https://media.example.test", f.row),
  );
  expect(message?.text).toContain("within 7 days");
  expect(message?.text).toContain(
    "Opening this link does not change your request",
  );
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.request.id } }),
  ).toMatchObject({ interestState: "following", interestNoticeViewedAt: null });
  await f.commands.execute(f.member, crypto.randomUUID(), f.input("continue"));
  expect(
    await f.db.$transaction((tx) =>
      composeInterestCheck(tx, "https://media.example.test", f.row),
    ),
  ).toBe(null);
});

test("wrong private recipient or edition cannot render or accept a check-in", async () => {
  const f = await noticeFixture();
  expect(
    await f.db.$transaction((tx) =>
      composeInterestCheck(tx, "https://media.example.test", {
        ...f.row,
        userId: f.owner.id,
      }),
    ),
  ).toBe(null);
  await f.db.applicationEvent.update({
    where: { id: f.event.id },
    data: {
      payload: {
        ...InterestCheckNoticeSchema.parse(f.event.payload),
        edition: "extended_cut",
      },
    },
  });
  const changed = await f.db.notificationDelivery.findUniqueOrThrow({
    where: { id: f.row.id },
    include: deliveryInclude,
  });
  expect(
    await f.db.$transaction((tx) =>
      composeInterestCheck(tx, "https://media.example.test", changed),
    ),
  ).toBe(null);
  await expect(
    f.commands.execute(f.member, crypto.randomUUID(), {
      ...f.input("notice_viewed"),
      noticeEventId: f.event.id,
    }),
  ).rejects.toMatchObject({ code: "notice_obsolete" });
  await expect(
    f.commands.execute(f.member, crypto.randomUUID(), {
      ...f.input("notice_viewed"),
      noticeEventId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "notice_obsolete" });
});

test("viewed in-app acceptance requires explicit authenticated POST command and exact notice revision", async () => {
  const f = await noticeFixture();
  await f.commands.execute(f.member, crypto.randomUUID(), {
    ...f.input("notice_viewed"),
    noticeEventId: f.event.id,
  });
  const result = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: f.request.id },
  });
  expect(result.interestNoticeViewedAt).not.toBe(null);
  expect(result.interestRevision).toBe(0);
  const listed = await listRequestInterests(f.db, f.member, null);
  expect(
    listed.items.find((item) => item.requestId === f.request.id)
      ?.noticeDeliveryState,
  ).toBe("accepted");
});

test("unavailable/unknown playback never ages an interest out", async () => {
  const f = await fixture();
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { usableUnwatchedSince: new Date(0), interestRenewedAt: new Date(0) },
  });
  const previousHex = (BigInt(`0x${f.request.id.replaceAll("-", "")}`) - 1n)
    .toString(16)
    .padStart(32, "0");
  const cursor = `${previousHex.slice(0, 8)}-${previousHex.slice(8, 12)}-${previousHex.slice(12, 16)}-${previousHex.slice(16, 20)}-${previousHex.slice(20)}`;
  expect(await reconcileRequestInterests(f.db, { cursor })).toMatchObject({
    processed: 1,
    nextCursor: f.request.id,
  });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.request.id } }),
  ).toMatchObject({
    interestState: "following",
    interestReleasedAt: null,
    usableUnwatchedSince: null,
  });
});
