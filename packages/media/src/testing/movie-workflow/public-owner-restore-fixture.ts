import { expect } from "vitest";
import { z } from "zod";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { createPublishedMovieFixture } from "./upgrade-fixture.ts";
import { authenticateMovieFixtureOwner } from "./owner-pin.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { readMovieTargetContextV4 } from "#infrastructure/movie-editions/lifecycle/target-view.ts";
import {
  MovieLifecycleCommandV4Schema,
  CancelMovieRequestV4Schema,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { evaluateMovieRetentionV4 } from "#automation/movie-editions/retention/evaluate.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Real owner removal and real personal cancellation leave no demand to substitute for explicit Restore. */
export async function createPublicOwnerRestoreFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
) {
  const f = await createPublishedMovieFixture(edition, bytes);
  try {
    const db = f.source.db;
    const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
    const row = await db.mediaUser.findFirstOrThrow({
      where: { role: "owner" },
    });
    const owner = await authenticateMovieFixtureOwner(f.source.context, {
      ...row,
      role: "owner",
    });
    const commands = new MovieLifecycleCommands(db, { keepDays: 7, ...access });
    const view = () =>
      db.$transaction((tx) =>
        readMovieTargetContextV4(tx, owner, { scope: f.scope, access }),
      );
    const reviewed = await view();
    if (reviewed.access !== "detail" || reviewed.removalConfirmation === null)
      throw new Error(
        "Actual owner removal requires its current full confirmation",
      );
    expect(reviewed.currentAsset).toMatchObject({
      id: f.asset.id,
      state: "published",
      captionsTruncated: false,
    });
    expect(
      reviewed.currentAsset?.captions
        .filter((caption) => caption.storageKind === "sidecar")
        .map((caption) => caption.language)
        .sort(),
    ).toEqual(["en", "zh-Hans"]);
    expect(
      reviewed.currentAsset?.captions.every((caption) => caption.accepted),
    ).toBe(true);
    const removed = await commands.executeMovieLifecycleV4(
      owner,
      crypto.randomUUID(),
      MovieLifecycleCommandV4Schema.parse({
        schemaVersion: 4,
        scope: f.scope,
        expected: reviewed.expected,
        command: {
          action: "remove",
          confirmation: reviewed.removalConfirmation,
        },
      }),
    );
    const removeOperation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(removed.result.operationId) },
    });
    const removeInput = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(removeOperation.payload),
    );
    const evaluation = await evaluateMovieRetentionV4(
      f.source.context,
      removeInput,
      testPlexBindingExecution(),
    );
    expect(evaluation.status).toBe("quarantine");
    const execution = testPublicationExecution();
    const decisionId = z.uuid().parse(evaluation.decisionId);
    await quarantineMovieFilesV4(
      {
        ...f.source.files.context,
        publicationExecution: () => execution,
        movieManagement: {
          execution,
          budget: new PublicationAuthorityReadBudget(),
        },
      },
      {
        schemaVersion: 4,
        operationId: removeInput.operationId,
        scope: f.scope,
        decisionId,
      },
    );
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.source.user.id,
          mediaId: f.scope.mediaId,
          edition,
        },
      },
    });
    const target = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    });
    await commands.cancelMovieEditionRequestV4(
      f.source.user,
      crypto.randomUUID(),
      CancelMovieRequestV4Schema.parse({
        schemaVersion: 4,
        scope: f.scope,
        subjectUserId: f.source.user.id,
        requestId: request.id,
        action: "cancel_request",
        expected: {
          targetVersion: target.version,
          requestVersion: request.version,
          choiceRevision: request.movieEditionChoiceRevision,
        },
      }),
    );
    expect(
      await db.mediaRequest.count({
        where: {
          mediaId: f.scope.mediaId,
          edition,
          active: true,
          excluded: false,
          direct: true,
        },
      }),
    ).toBe(0);
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
    ).toMatchObject({
      desiredPresence: false,
      monitoring: false,
      libraryMonitoring: false,
      availability: "quarantined",
    });
    const quarantined = await view();
    if (quarantined.access !== "detail")
      throw new Error(
        "Actual configured owner quarantine lost its detail access",
      );
    expect(quarantined.currentAsset).toMatchObject({
      id: f.asset.id,
      state: "quarantined",
    });
    expect(
      quarantined.currentAsset?.captions.every(
        (caption) => caption.state === "quarantined" && !caption.accepted,
      ),
    ).toBe(true);
    return {
      f,
      db,
      owner,
      commands,
      view,
      removeInput,
      decisionId,
      close: f.close,
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
