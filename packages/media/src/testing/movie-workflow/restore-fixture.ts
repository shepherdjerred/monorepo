import { expect } from "vitest";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { createMovieRetentionFixture } from "./retention-fixture.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { restoreMovieFilesV4 } from "#automation/movie-editions/retention/restore.ts";

/** Actual acquisition, accepted warning, physical quarantine and requester-owned restore. */
export async function createRestoredMovieFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  options: { sibling?: boolean; subtitleLanguages?: string[] } = {},
) {
  const f = await createMovieRetentionFixture(edition, bytes);
  try {
    const siblingEdition =
      options.sibling === true
        ? edition === "directors_cut"
          ? "final_cut"
          : "directors_cut"
        : null;
    if (siblingEdition !== null) {
      await requestTestMovieV4(
        f.db,
        f.source.user,
        f.scope.mediaId,
        siblingEdition,
      );
      await f.db.retentionHold.create({
        data: {
          userId: f.source.user.id,
          mediaId: f.scope.mediaId,
          edition: siblingEdition,
          isPin: true,
        },
      });
    }
    const initialBinding = await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    });
    if (initialBinding.evidenceId === null)
      throw new Error("Actual movie publication omitted its Plex association");
    const initialAssociation =
      await f.db.plexAssociationEvidence.findUniqueOrThrow({
        where: { id: initialBinding.evidenceId },
      });
    expect(await f.warning()).toMatchObject({ status: "warning" });
    await f.deliverWarning();
    const evaluation = await f.evaluate();
    expect(evaluation.status).toBe("quarantine");
    if (evaluation.decisionId === null || f.context.now === undefined)
      throw new Error(
        "Actual retention producer omitted its physical authority",
      );
    const invocation = () => {
      const execution = testPublicationExecution();
      return {
        ...f.source.files.context,
        publicationExecution: () => execution,
        movieManagement: {
          execution,
          budget: new PublicationAuthorityReadBudget(),
        },
      };
    };
    await quarantineMovieFilesV4(
      { ...invocation(), now: f.context.now },
      {
        schemaVersion: 4,
        operationId: f.input.operationId,
        decisionId: evaluation.decisionId,
        scope: f.scope,
      },
    );
    const request = await requestTestMovieV4(
      f.db,
      f.source.user,
      f.scope.mediaId,
      options.subtitleLanguages === undefined
        ? edition
        : { edition, subtitleLanguages: options.subtitleLanguages },
    );
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: request.input.operationId },
      }),
    ).toMatchObject({ kind: "restore_movie_edition_v4" });
    await restoreMovieFilesV4(invocation(), request.input);
    const physicalRestore = await f.db.operation.findUniqueOrThrow({
      where: { id: request.input.operationId },
    });
    return {
      ...f,
      input: request.input,
      retentionInput: f.input,
      decisionId: evaluation.decisionId,
      initialBinding,
      initialAssociation,
      physicalRestore,
      restoreRequest: request,
      siblingEdition,
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
