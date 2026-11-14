import type { FileContext } from "#automation/files/types.ts";
import type { ReleaseAttributes } from "#shared/contract.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { assertMeasuredUpgrade } from "./guard.ts";
import {
  MeasuredContentRejection,
  rejectUnstagedContentV1,
} from "#automation/files/content-rejection.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { assertAcquisition } from "#automation/files/guards.ts";

/** Only the fresh physical inspection path can turn measured rejection into automatic reselection. */
export async function assertInspectedQualityV1(
  context: FileContext,
  input: {
    attemptId: string;
    measured: ReleaseAttributes;
    mediaIds: string[];
    attemptMediaIds: string[];
    movieAccess: MovieChoiceAccess | undefined;
  },
) {
  try {
    return await assertMeasuredUpgrade(
      context.db,
      input.measured,
      input.mediaIds,
    );
  } catch (error) {
    if (error instanceof MeasuredContentRejection)
      await context.db.$transaction(async (tx) => {
        await lockAcquisitionMedia(tx, input.attemptMediaIds);
        await assertAcquisition(tx, input.attemptId, {
          serverMachineId: context.serverMachineId,
          movieAccess: input.movieAccess,
          libraryManagement: context.libraryManagement,
        });
        await rejectUnstagedContentV1(
          tx,
          input.attemptId,
          error,
          context.libraryManagement?.budget,
        );
      });
    throw error;
  }
}
