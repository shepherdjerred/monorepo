import { expect, test } from "vitest";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { ActivateMovieEditionChoiceV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

test("a genuine later v3 declaration cannot activate over the original reserved v4 acquisition", async () => {
  const f = await createMovieWorkflowFixture("directors_cut");
  try {
    const db = f.source.db;
    expect(
      await f.movie.reconcileMovieIntentV4(f.input, testPlexBindingExecution()),
    ).toMatchObject({ status: "acquire" });
    const reader = new PrismaMediaApplication(db, {
      keepDays: 7,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    });
    const context = await reader.getMovieEditionContextV4(
      f.source.user,
      f.input.mediaId,
      f.source.user.id,
    );
    expect(
      context.options.find((row) => row.edition === "directors_cut"),
    ).toMatchObject({
      acquisition: "protected",
      reasons: ["acquisition_active"],
    });
    const admission = await reader.getMovieTargetContextV4(
      f.source.user,
      f.input.scope,
    );
    if (admission.access !== "detail")
      throw new Error(
        "Actual configured requester unexpectedly lost detail access",
      );
    expect(admission.allowedActions).not.toContain("retry");
    expect(admission.allowedActions).not.toContain("select_release");
    const selected = await chooseTestMovieEdition(db, {
      actor: f.source.user,
      mediaId: f.input.scope.mediaId,
      edition: "directors_cut",
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
    });
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: selected.result.requestId },
    });
    const target = await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.input.mediaId, edition: "directors_cut" },
      },
    });
    const media = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.input.mediaId },
    });
    const reservation = await db.acquisitionReservation.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.input.mediaId, edition: "directors_cut" },
      },
      include: { attempt: true },
    });
    const input = ActivateMovieEditionChoiceV4Schema.parse({
      schemaVersion: 4,
      scope: f.input.scope,
      subjectUserId: f.source.user.id,
      requestId: request.id,
      choiceId: request.movieEditionChoiceId,
      expected: {
        mediaVersion: media.version,
        targetVersion: target.version,
        requestVersion: request.version,
        choiceRevision: request.movieEditionChoiceRevision,
      },
    });
    const count = await db.operation.count();
    await expect(
      new MovieLifecycleCommands(db, {
        keepDays: 7,
        serverMachineId: "fixture-server",
        movieSectionId: "1",
      }).activateMovieEditionChoiceV4(
        f.source.user,
        crypto.randomUUID(),
        input,
      ),
    ).rejects.toMatchObject({ code: "native_operation_unsettled" });
    expect(
      await db.mediaItem.findUniqueOrThrow({ where: { id: media.id } }),
    ).toEqual(media);
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: { mediaId: target.mediaId, edition: target.edition },
        },
      }),
    ).toEqual(target);
    expect(
      await db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toEqual(request);
    expect(
      await db.acquisitionReservation.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: reservation.mediaId,
            edition: reservation.edition,
          },
        },
        include: { attempt: true },
      }),
    ).toEqual(reservation);
    expect(await db.operation.count()).toBe(count);
    expect(f.source.wire.additions()).toBe(0);
  } finally {
    await f.close();
  }
}, 60_000);
