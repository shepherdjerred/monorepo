import { expect, test } from "vitest";
import { recoveryHarness } from "./recovery/test-support.ts";
import { PrismaMediaCommands } from "./commands.ts";
import { PrismaAuthStore } from "./auth-store.ts";
import { z } from "zod";

const { fixture } = recoveryHarness();

test.each(["demoted", "restricted"] as const)(
  "a stale %s owner cannot queue a managed profile request",
  async (change) => {
    const f = await fixture();
    await f.db.plexIdentityMapping.update({
      where: { userId: f.member.id },
      data: {
        kind: "managed",
        homeUserId: f.member.plexAccountId,
        plexRestricted: true,
      },
    });
    const commands = new PrismaMediaCommands(f.db, {
      keepDays: 30,
      serverMachineId: "fixture",
    });
    await f.db.mediaIntent.update({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      data: { automationEpoch: 2 },
    });
    const before = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    await f.db.mediaUser.update({
      where: { id: f.owner.id },
      data: change === "demoted" ? { role: "member" } : { restricted: true },
    });
    await expect(
      commands.createRequest(f.owner, crypto.randomUUID(), {
        mediaId: f.media.id,
        requesterUserId: f.member.id,
        subtitleLanguages: [],
        includeSpecials: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.claim.id } }),
    ).toEqual(f.claim);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      }),
    ).toEqual(before);
    expect(
      await f.db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
    ).toMatchObject({ version: 0 });
    expect(
      await f.db.outboxCommand.count({
        where: { operation: { targetId: f.media.id } },
      }),
    ).toBe(0);
  },
);

test("current unrestricted owner may request for an exactly scoped Plex-restricted managed profile", async () => {
  const f = await fixture();
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: {
      kind: "managed",
      homeUserId: f.member.plexAccountId,
      plexRestricted: true,
    },
  });
  const commands = new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
  });
  const result = await commands.createRequest(f.owner, crypto.randomUUID(), {
    mediaId: f.media.id,
    requesterUserId: f.member.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  expect(result).toMatchObject({ status: "queued", requestId: f.claim.id });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 3, generation: 5 });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.claim.id } }),
  ).toMatchObject({ userId: f.member.id, version: 1 });
});

test("proxy owner restriction committed while createRequest waits on media locks rejects without writes", async () => {
  const f = await fixture();
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: {
      kind: "managed",
      homeUserId: f.member.plexAccountId,
      plexRestricted: true,
    },
  });
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const blocker = f.db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${f.media.id} FOR UPDATE`;
      locked.resolve(undefined);
      await release.promise;
    },
    { timeout: 10_000 },
  );
  await locked.promise;
  const command = new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
  }).createRequest(f.owner, crypto.randomUUID(), {
    mediaId: f.media.id,
    requesterUserId: f.member.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  const outcome = (async () => {
    try {
      await command;
      return "accepted";
    } catch (error) {
      return error;
    }
  })();
  try {
    await expect
      .poll(
        async () => {
          const rows = z
            .array(z.object({ waiting: z.boolean() }))
            .parse(
              await f.db
                .$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%MediaItem%' AND pid <> pg_backend_pid()) AS waiting`,
            );
          return rows[0]?.waiting;
        },
        { timeout: 2000, interval: 10 },
      )
      .toBe(true);
    await f.db.mediaUser.update({
      where: { id: f.owner.id },
      data: { restricted: true, version: { increment: 1 } },
    });
  } finally {
    release.resolve(undefined);
    await blocker;
  }
  expect(await outcome).toMatchObject({ status: 403 });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.claim.id } }),
  ).toEqual(f.claim);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ generation: 4 });
  expect(
    await f.db.outboxCommand.count({
      where: { operation: { targetId: f.media.id } },
    }),
  ).toBe(0);
});

test("access revocation committed while Retry waits on media authority is observed before any renewal", async () => {
  const f = await fixture();
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const blocker = f.db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${f.media.id} FOR UPDATE`;
      locked.resolve(undefined);
      await release.promise;
    },
    { timeout: 10_000 },
  );
  await locked.promise;
  const command = new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
  }).act(f.member, crypto.randomUUID(), f.media.id, {
    action: "retry",
    expectedVersion: 0,
  });
  const outcome = (async () => {
    try {
      await command;
      return "accepted";
    } catch (error) {
      return error;
    }
  })();
  try {
    await expect
      .poll(
        async () => {
          const rows = z
            .array(z.object({ waiting: z.boolean() }))
            .parse(
              await f.db
                .$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%MediaItem%' AND pid <> pg_backend_pid()) AS waiting`,
            );
          return rows[0]?.waiting;
        },
        { timeout: 2000, interval: 10 },
      )
      .toBe(true);
    await new PrismaAuthStore(f.db).updateAccess(f.member.id, {
      accountId: f.member.plexAccountId,
      serverMachineId: "fixture",
      permittedSectionIds: [],
      permittedMediaKinds: [],
      plexRestricted: false,
    });
  } finally {
    release.resolve(undefined);
    await blocker;
  }
  expect(await outcome).toMatchObject({ status: 403 });
  expect(
    await f.db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
  ).toMatchObject({ version: 0 });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ generation: 4 });
  expect(
    await f.db.outboxCommand.count({
      where: { operation: { targetId: f.media.id } },
    }),
  ).toBe(0);
});

test.each([
  "restricted",
  "revoked",
  "plex_restricted",
  "wrong_section",
] as const)(
  "Retry rejects current %s access despite an earlier effective claim and stale actor",
  async (change) => {
    const f = await fixture();
    const commands = new PrismaMediaCommands(f.db, {
      keepDays: 30,
      serverMachineId: "fixture",
    });
    await f.db.mediaIntent.update({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      data: { automationEpoch: 2 },
    });
    if (change === "restricted")
      await f.db.mediaUser.update({
        where: { id: f.member.id },
        data: { restricted: true },
      });
    else
      await new PrismaAuthStore(f.db).updateAccess(f.member.id, {
        accountId: f.member.plexAccountId,
        serverMachineId: "fixture",
        permittedSectionIds:
          change === "revoked" ? [] : [change === "wrong_section" ? "2" : "1"],
        permittedMediaKinds: change === "revoked" ? [] : ["movie"],
        plexRestricted: change === "plex_restricted",
      });
    const before = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    await expect(
      commands.act(f.member, crypto.randomUUID(), f.media.id, {
        action: "retry",
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      }),
    ).toEqual(before);
    expect(
      await f.db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
    ).toMatchObject({ version: 0 });
    expect(
      await f.db.operation.count({ where: { targetId: f.media.id } }),
    ).toBe(0);
    expect(
      await f.db.outboxCommand.count({
        where: { operation: { targetId: f.media.id } },
      }),
    ).toBe(0);
    await commands.act(f.member, crypto.randomUUID(), f.media.id, {
      action: "keep",
      expectedVersion: 0,
    });
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      }),
    ).toMatchObject({ automationEpoch: 2 });
    await commands.cancelRequest(
      f.member,
      crypto.randomUUID(),
      f.claim.id,
      f.claim.version,
    );
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.claim.id } }),
    ).toMatchObject({ active: false });
  },
);

test("manual release selection uses current owner role and scoped access; protective pin survives revoked library access", async () => {
  const f = await fixture();
  const commands = new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
    movieSectionId: "1",
  });
  const candidate = await f.db.releaseCandidate.create({
    data: {
      providerId: "fixture",
      providerReleaseId: crypto.randomUUID(),
      title: "Candidate",
      attributes: {},
      evaluation: {},
      mediaIds: [f.media.id],
    },
  });
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member" },
  });
  await expect(
    commands.act(f.owner, crypto.randomUUID(), f.media.id, {
      action: "select_release",
      releaseId: candidate.id,
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "owner" },
  });
  await new PrismaAuthStore(f.db).updateAccess(f.owner.id, {
    accountId: f.owner.plexAccountId,
    serverMachineId: "fixture",
    permittedSectionIds: [],
    permittedMediaKinds: [],
    plexRestricted: false,
  });
  await expect(
    commands.act(f.owner, crypto.randomUUID(), f.media.id, {
      action: "select_release",
      releaseId: candidate.id,
      expectedVersion: 0,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(await f.db.operation.count({ where: { targetId: f.media.id } })).toBe(
    0,
  );
  await commands.act(f.owner, crypto.randomUUID(), f.media.id, {
    action: "pin",
    expectedVersion: 0,
  });
  expect(
    await f.db.retentionHold.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.owner.id,
          mediaId: f.media.id,
          edition: "default",
        },
      },
    }),
  ).toMatchObject({ isPin: true });
});

test("currently scoped Retry grants current intent authority and a new operation while the system hold remains", async () => {
  const f = await fixture();
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    data: { automationEpoch: 2 },
  });
  const commands = new PrismaMediaCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture",
  });
  const result = await commands.act(f.member, crypto.randomUUID(), f.media.id, {
    action: "retry",
    expectedVersion: 0,
  });
  expect(result.operationId).toBeDefined();
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 3, generation: 5 });
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ releasedAt: null });
});
