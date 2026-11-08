import { expect, test } from "vitest";
import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { CancelMovieRequestV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { CreateRequestSchema } from "#shared/contract.ts";

test("actual unconfigured-section discovery returns only personal protection and cancels a genuine legacy null-choice request", async () => {
  const f = await createMovieWorkflowFixture("directors_cut");
  try {
    const db = f.source.db;
    const actor = f.source.user;
    const service = new PrismaMediaApplication(db, {
      keepDays: 7,
      serverMachineId: "fixture-server",
    });
    const before = await db.operation.count();
    const page = await service.listMovieEditionRequestsV4(actor, {
      subjectUserId: actor.id,
      cursor: null,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      access: "protection_only",
      scope: f.input.scope,
      fulfillment: { status: "protected", reason: "plex_scope_unconfigured" },
      canCancel: true,
      canRevokeChoice: true,
    });
    expect(page.items[0]).not.toHaveProperty("title");
    expect(page.items[0]).not.toHaveProperty("editionLabel");
    const context = await service.getMovieTargetContextV4(actor, f.input.scope);
    expect(context).toMatchObject({
      access: "protection_only",
      allowedProtectiveActions: ["keep", "cancel_request", "revoke_choice"],
    });
    expect(context).not.toHaveProperty("target");
    expect(context).not.toHaveProperty("removalConfirmation");
    await expect(
      service.getMovieEditionContextV4(actor, f.input.mediaId, actor.id),
    ).rejects.toMatchObject({ code: "plex_scope_unconfigured" });
    expect(await db.operation.count()).toBe(before);
    expect(f.source.wire.additions()).toBe(0);

    const full = new PrismaMediaApplication(db, {
      keepDays: 7,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    });
    const existingOwner = await db.mediaUser.findFirstOrThrow({
      where: { role: "owner" },
    });
    const owner = await authenticateMovieFixtureOwner(f.source.context, {
      ...existingOwner,
      role: "owner",
    });
    const other = await db.mediaItem.create({
      data: { kind: "movie", title: "Another household movie" },
    });
    await full.createRequest(
      owner,
      crypto.randomUUID(),
      CreateRequestSchema.parse({
        mediaId: other.id,
        subtitleLanguages: [],
        includeFutureEpisodes: false,
        includeSpecials: false,
      }),
    );
    await expect(
      service.getMovieTargetContextV4(actor, {
        rootMediaId: other.id,
        mediaId: other.id,
        edition: "default",
      }),
    ).rejects.toMatchObject({ code: "movie_protection_scope_not_found" });

    const legacyMedia = await db.mediaItem.create({
      data: { kind: "movie", title: "Actual unversioned request" },
    });
    const input = CreateRequestSchema.parse({
      mediaId: legacyMedia.id,
      subtitleLanguages: [],
      includeFutureEpisodes: false,
      includeSpecials: false,
    });
    const key = crypto.randomUUID();
    const created = await full.createRequest(actor, key, input);
    const requestId = z.uuid().parse(created.requestId);
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(request).toMatchObject({
      movieEditionChoiceId: null,
      movieEditionChoiceRevision: 0,
      active: true,
    });
    const target = await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: legacyMedia.id, edition: "default" },
      },
    });
    const source = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(created.operationId) },
      include: { outbox: true },
    });
    const legacyPage = await service.listMovieEditionRequestsV4(actor, {
      subjectUserId: actor.id,
      cursor: null,
    });
    const item = legacyPage.items.find((row) => row.requestId === requestId);
    expect(item).toMatchObject({
      access: "protection_only",
      activationRequired: false,
      fulfillment: {
        status: "pending_choice",
        reason: "movie_edition_choice_required",
      },
      canCancel: true,
      canRevokeChoice: false,
    });
    const scope = {
      rootMediaId: legacyMedia.id,
      mediaId: legacyMedia.id,
      edition: "default" as const,
    };
    expect(
      await service.cancelMovieEditionRequestV4(
        actor,
        crypto.randomUUID(),
        CancelMovieRequestV4Schema.parse({
          schemaVersion: 4,
          scope,
          subjectUserId: actor.id,
          requestId,
          action: "cancel_request",
          expected: {
            targetVersion: target.version,
            requestVersion: request.version,
            choiceRevision: request.movieEditionChoiceRevision,
          },
        }),
      ),
    ).toMatchObject({ state: "cancelled", choiceId: null });
    const after = await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: legacyMedia.id, edition: "default" },
      },
    });
    expect(after.editionRootId).toBe(target.editionRootId);
    expect(await db.movieEditionChoice.count({ where: { requestId } })).toBe(0);
    expect(
      await db.operation.findUniqueOrThrow({
        where: { id: source.id },
        include: { outbox: true },
      }),
    ).toEqual(source);
    expect(await full.createRequest(actor, key, input)).toEqual(created);
  } finally {
    await f.close();
  }
}, 60_000);
