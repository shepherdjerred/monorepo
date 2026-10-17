import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { commandFixture } from "./command-test-support.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test.each(["revoked", "stale"])(
  "%s library access retains minimal own Keep/cancel and denies acquisition",
  async (denial) => {
    const db = cluster.database;
    const f = await commandFixture(db);
    const created = await f.service.executeDefaultCommand(
      f.actor,
      crypto.randomUUID(),
      await f.command({ action: "request" }),
    );
    await db.plexIdentityMapping.update({
      where: { userId: f.actor.id },
      data:
        denial === "revoked"
          ? { permittedSectionIds: [] }
          : { verifiedAt: new Date(Date.now() - 600_000) },
    });
    const context = await f.service.getDefaultCommandContext(
      f.actor,
      f.media.id,
    );
    expect(context).toEqual({
      schemaVersion: 2,
      scope: { mediaId: f.media.id, edition: "default" },
      expected: { mediaVersion: 1, targetVersion: 0 },
      access: "protection_only",
      ownRequests: [
        {
          id: created.result.requestId,
          version: 0,
          active: true,
          canCancel: true,
        },
      ],
      allowedProtectiveActions: ["keep", "cancel_request"],
    });
    await expect(f.service.getMedia(f.actor, f.media.id)).rejects.toMatchObject(
      { status: 403 },
    );
    const before = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: context.scope },
    });
    await expect(
      f.service.executeDefaultCommand(
        f.actor,
        crypto.randomUUID(),
        await f.command({ action: "retry" }),
      ),
    ).rejects.toMatchObject({ code: "plex_library_access_required" });
    await f.service.executeDefaultCommand(
      f.actor,
      crypto.randomUUID(),
      await f.command({ action: "keep" }),
    );
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: context.scope },
      }),
    ).toMatchObject({ automationEpoch: before.automationEpoch });
    await f.service.executeDefaultCommand(
      f.actor,
      crypto.randomUUID(),
      await f.command({
        action: "cancel_request",
        requestId: created.result.requestId,
        requestVersion: 0,
      }),
    );
    const cancelled = await f.service.getDefaultCommandContext(
      f.actor,
      f.media.id,
    );
    expect(cancelled.allowedProtectiveActions).toEqual([]);
    expect(cancelled.ownRequests).toMatchObject([
      { active: false, canCancel: false },
    ]);
    await expect(
      f.service.executeDefaultCommand(
        f.actor,
        crypto.randomUUID(),
        await f.command({ action: "keep" }),
      ),
    ).rejects.toMatchObject({ code: "request_required" });
  },
);

test("unrelated revoked users get no context; orphan claims remain protective without repairing lineage", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { kind: "episode", title: "Private orphan" },
  });
  await createTestDefaultTarget(db, f.media.id, { automationEpoch: -1 });
  const request = await db.mediaRequest.create({
    data: { mediaId: f.media.id, userId: f.actor.id },
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { permittedSectionIds: [] },
  });
  const other = await commandFixture(db);
  await db.plexIdentityMapping.update({
    where: { userId: other.actor.id },
    data: { permittedSectionIds: [] },
  });
  await expect(
    f.service.getDefaultCommandContext(other.actor, f.media.id),
  ).rejects.toMatchObject({ code: "forbidden" });
  await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    await f.command({ action: "keep" }),
  );
  await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    await f.command({
      action: "cancel_request",
      requestId: request.id,
      requestVersion: request.version,
    }),
  );
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ editionRootId: null, automationEpoch: -1 });
  expect(
    await db.retentionHold.count({
      where: { mediaId: f.media.id, userId: f.actor.id },
    }),
  ).toBe(1);
});

test("root cancellation removes inherited Keep before paginated coverage cleanup", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const root = await db.mediaItem.create({
    data: { kind: "series", title: "Scoped series" },
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { kind: "episode", parentId: root.id },
  });
  await createTestDefaultTarget(db, root.id);
  await createTestDefaultTarget(db, f.media.id);
  const rootRequest = await db.mediaRequest.create({
    data: { mediaId: root.id, userId: f.actor.id },
  });
  const leafRequest = await db.mediaRequest.create({
    data: { mediaId: f.media.id, userId: f.actor.id, direct: false },
  });
  await db.requestCoverage.create({
    data: {
      rootRequestId: rootRequest.id,
      requestId: leafRequest.id,
      mediaId: f.media.id,
      sourceVersion: rootRequest.version,
    },
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { permittedSectionIds: [] },
  });
  const inherited = await f.service.getDefaultCommandContext(
    f.actor,
    f.media.id,
  );
  expect(inherited.allowedProtectiveActions).toContain("keep");
  const context = await f.service.getDefaultCommandContext(f.actor, root.id);
  await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    DefaultCommandV2Schema.parse({
      schemaVersion: 2,
      scope: context.scope,
      expected: context.expected,
      command: {
        action: "cancel_request",
        requestId: rootRequest.id,
        requestVersion: 0,
      },
    }),
  );
  expect(
    await db.mediaRequest.findUniqueOrThrow({ where: { id: leafRequest.id } }),
  ).toMatchObject({ active: true });
  const excluded = await f.service.getDefaultCommandContext(
    f.actor,
    f.media.id,
  );
  expect(excluded.allowedProtectiveActions).not.toContain("keep");
  await expect(
    f.service.executeDefaultCommand(
      f.actor,
      crypto.randomUUID(),
      await f.command({ action: "keep" }),
    ),
  ).rejects.toMatchObject({ code: "request_required" });
});

test("owner pin context requires no Plex access and stale owner role cannot pin anew", async () => {
  const db = cluster.database;
  const f = await commandFixture(db, "owner");
  await db.plexIdentityMapping.delete({ where: { userId: f.actor.id } });
  const context = await f.service.getDefaultCommandContext(f.actor, f.media.id);
  expect(context.access).toBe("protection_only");
  expect(context.expected.targetVersion).toBeNull();
  expect(context.allowedProtectiveActions).toEqual(["keep", "pin"]);
  const input = await f.command({ action: "pin" });
  const key = crypto.randomUUID();
  const original = await f.service.executeDefaultCommand(f.actor, key, input);
  await db.mediaUser.update({
    where: { id: f.actor.id },
    data: { role: "member" },
  });
  const unpin = DefaultCommandV2Schema.parse({
    ...input,
    expected: original.appliedVersions,
    command: { action: "unpin" },
  });
  await expect(
    f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), unpin),
  ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  expect(await f.service.executeDefaultCommand(f.actor, key, input)).toEqual(
    original,
  );
  expect(
    await db.retentionHold.findFirstOrThrow({ where: { mediaId: f.media.id } }),
  ).toMatchObject({ isPin: true });
});

test("detail context reports changed canonical lineage without creating or repairing targets", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const oldRoot = await db.mediaItem.create({
    data: { kind: "series", title: "Old root" },
  });
  const newRoot = await db.mediaItem.create({
    data: { kind: "series", title: "New root" },
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { kind: "episode", parentId: oldRoot.id },
  });
  await createTestDefaultTarget(db, f.media.id);
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { parentId: newRoot.id },
  });
  expect(
    await f.service.getDefaultCommandContext(f.actor, f.media.id),
  ).toMatchObject({ access: "detail", target: { lineage: "unresolved" } });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ editionRootId: oldRoot.id });
});
