import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { commandFixture } from "./command-test-support.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { z } from "zod";
import { householdRetentionState } from "#infrastructure/request-interest/protection.ts";

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

test("leaving soon is the household's: any member who can see the title sees its removal and may hold it for 30 days, and nothing else", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const media = f.media.id;
  const requested = await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    await f.command({ action: "request" }),
  );
  const requestId = z.uuid().parse(requested.result.requestId);
  // A title leaves once nobody follows it: the one who asked has finished.
  await db.mediaRequest.update({
    where: { id: requestId },
    data: {
      interestState: "finished",
      interestReleasedAt: new Date(),
      interestReleaseReason: "watched",
    },
  });
  const { actor: housemate } = await commandFixture(db);
  // The title is a movie in section 1; this member may open only section 2.
  const { actor: outsider } = await commandFixture(db);
  await db.plexIdentityMapping.update({
    where: { userId: outsider.id },
    data: { permittedSectionIds: ["2"] },
  });
  const { actor: lapsed } = await commandFixture(db);
  await db.plexIdentityMapping.update({
    where: { userId: lapsed.id },
    data: { verifiedAt: new Date(Date.now() - 600_000) },
  });
  const { actor: owner } = await commandFixture(db, "owner");
  type Actor = typeof f.actor;
  const act = async (actor: Actor, command: unknown) =>
    f.service.executeDefaultCommand(
      actor,
      crypto.randomUUID(),
      await f.command(command),
    );
  const allowed = async (actor: Actor) => {
    const context = await f.service.getDefaultCommandContext(actor, media);
    return context.allowedProtectiveActions;
  };
  const listed = async (actor: Actor) => {
    const removals = await f.service.removals(actor);
    return removals.map((row) => row.id);
  };
  const household = () =>
    db.$transaction((tx) => householdRetentionState(tx, media));

  // Nothing is leaving yet: someone else's title is not a member's to keep.
  expect(await allowed(housemate)).toEqual([]);
  await expect(act(housemate, { action: "keep" })).rejects.toMatchObject({
    code: "request_required",
  });
  expect(await household()).toMatchObject({ reason: null });

  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media, edition: "default" } },
  });
  const removal = await db.retentionDecision.create({
    data: {
      mediaId: media,
      generation: target.generation,
      state: "grace_period",
      evidence: { recoveryEpoch: 0 },
      graceUntil: new Date(Date.now() + 3 * 86_400_000),
    },
  });
  // Everyone whose libraries hold the title sees it, the one who asked too.
  for (const actor of [housemate, f.actor, owner])
    expect(await listed(actor)).toContain(removal.id);
  expect(await allowed(housemate)).toEqual(["keep"]);
  expect(await allowed(f.actor)).toEqual(["keep", "cancel_request"]);
  // A member must not learn of a title outside their libraries, nor act on it.
  for (const actor of [outsider, lapsed]) {
    expect(await listed(actor)).not.toContain(removal.id);
    await expect(
      f.service.getDefaultCommandContext(actor, media),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(act(actor, { action: "keep" })).rejects.toMatchObject({
      code: "request_required",
    });
  }
  // Only the hold is the household's. Everything else is as it was.
  const refused = {
    pin: "forbidden",
    unpin: "forbidden",
    remove: "forbidden",
    restore: "request_required",
    retry: "request_required",
  };
  for (const [action, code] of Object.entries(refused))
    await expect(act(housemate, { action }), action).rejects.toMatchObject({
      code,
    });
  await expect(
    act(housemate, {
      action: "cancel_request",
      requestId,
      requestVersion: 0,
    }),
  ).rejects.toMatchObject({ status: 403 });

  const claims = () => db.mediaRequest.findMany({ where: { mediaId: media } });
  const before = await claims();
  await act(housemate, { action: "keep" });
  // The removal is stopped and leaves every list.
  expect(
    await db.retentionDecision.findUniqueOrThrow({ where: { id: removal.id } }),
  ).toMatchObject({ state: "cancelled" });
  expect(await listed(housemate)).not.toContain(removal.id);
  // The hold is the housemate's own, and no request was invented for them.
  const holds = await db.retentionHold.findMany({ where: { mediaId: media } });
  expect(holds).toMatchObject([
    { userId: housemate.id, edition: "default", isPin: false },
  ]);
  const days = ((holds[0]?.until?.getTime() ?? 0) - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);
  expect(await claims()).toEqual(before);
  expect(
    await db.applicationEvent.findMany({
      where: { mediaId: media, kind: "media_keep" },
    }),
  ).toMatchObject([{ actorId: housemate.id }]);
  // The hold protects the title for the whole household. Whoever holds it,
  // only those who asked for the title are told about a later removal.
  const held = await household();
  expect(held.reason).toBe("ancestor_keep_hold");
  expect(held.recipients.map((recipient) => recipient.userId)).toEqual([
    f.actor.id,
  ]);
  // With the removal stopped there is nothing left to hold.
  expect(await allowed(housemate)).toEqual([]);
  await expect(act(housemate, { action: "keep" })).rejects.toMatchObject({
    code: "request_required",
  });
  // The hold lapses on its own date; retention does not wait on its holder.
  await db.retentionHold.updateMany({
    where: { mediaId: media },
    data: { until: new Date(Date.now() - 1000) },
  });
  const lapsedHold = await household();
  expect(lapsedHold.reason).toBeNull();
  expect(lapsedHold.recipients.map((recipient) => recipient.userId)).toEqual([
    f.actor.id,
  ]);

  // Quarantined files have already left the library. That is not "leaving
  // soon": restoring stays with the owner and the members following a title.
  const current = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media, edition: "default" } },
  });
  const gone = await db.retentionDecision.create({
    data: {
      mediaId: media,
      generation: current.generation,
      state: "quarantined",
      evidence: { recoveryEpoch: 0 },
      quarantinedAt: new Date(),
      purgeAfter: new Date(Date.now() + 7 * 86_400_000),
      manifest: { assets: [] },
    },
  });
  expect(await listed(owner)).toContain(gone.id);
  expect(await listed(housemate)).not.toContain(gone.id);
  expect(await allowed(housemate)).toEqual([]);
  for (const action of ["keep", "restore"])
    await expect(act(housemate, { action }), action).rejects.toMatchObject({
      code: "request_required",
    });
  expect(await db.retentionHold.count({ where: { mediaId: media } })).toBe(1);
});
