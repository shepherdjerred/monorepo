import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { authorizeMovieFilesV4, assertMovieFilePlanV4 } from "./authority.ts";
import { prepareMovieFilePlanV4 } from "./inspection-plan.ts";
import { stageMoviePlanV4 } from "./staging.ts";

export async function inspectAndStageMovieV4(
  initial: FileContext,
  raw: MovieAttemptOperationV4,
) {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const context = {
    ...publicationInvocation(initial, execution),
    movieManagement: {
      execution,
      budget: new PublicationAuthorityReadBudget(),
    },
  };
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const access = requireMovieChoiceAccess(
    (await fileMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  const authority = await context.db.$transaction((tx) =>
    authorizeMovieFilesV4(tx, context, input, access),
  );
  const reauthorize = async () => {
    const current = await context.db.$transaction((tx) =>
      authorizeMovieFilesV4(tx, context, input, access),
    );
    current.freshness.assertActive();
    execution.assertActive();
  };
  const prepared =
    authority.attempt.filePlan === null
      ? await prepareMovieFilePlanV4(context, input, authority, reauthorize)
      : MovieFilePlanSchema.parse(authority.attempt.filePlan);
  const plan = await context.db.$transaction(async (tx) => {
    const current = await authorizeMovieFilesV4(tx, context, input, access);
    if (current.attempt.filePlan !== null) {
      const retained = MovieFilePlanSchema.parse(current.attempt.filePlan);
      if (
        authority.attempt.filePlan !== null &&
        snapshotHash(nativeJson(current.attempt.filePlan)) !==
          snapshotHash(nativeJson(authority.attempt.filePlan))
      )
        throw new FileGuardError("movie_file_plan_changed");
      await assertMovieFilePlanV4(tx, context, current, retained);
      return retained;
    }
    await assertMovieFilePlanV4(tx, context, current, prepared);
    await tx.acquisitionAttempt.update({
      where: { id: input.attemptId },
      data: {
        filePlan: z.record(z.string(), z.json()).parse(prepared),
        state: "validating",
      },
    });
    current.freshness.assertActive();
    execution.assertActive();
    return prepared;
  });
  await stageMoviePlanV4(context, input, plan, access);
}
