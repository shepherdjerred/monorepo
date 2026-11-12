import { ApplicationFailure } from "@temporalio/workflow";
import type {
  MediaAttemptOperation,
  MediaFileActivities,
  MediaStagingInput,
} from "@shepherdjerred/media/automation";

/** The hint partitions work; each real Activity reacquires its own original authority. */
export async function stageOrdinaryMedia(
  input: MediaAttemptOperation,
  inspect: MediaFileActivities["inspectAndStageMedia"],
) {
  let stagingBatch: NonNullable<MediaStagingInput["stagingBatch"]> = {
    schemaVersion: 1,
    batchIndex: null,
  };
  // One planning invocation followed by at most25 contiguous four-file batches.
  for (let count = 0; count < 26; count++) {
    const result = await inspect({
      operationId: input.operationId,
      attemptId: input.attemptId,
      stagingBatch,
    });
    // Older Files workers ignore the hint and return their actual whole-plan result.
    switch (result.status) {
      case "staged":
      case "blocked":
        return result;
      case "staging":
        break;
      default:
        throw ApplicationFailure.nonRetryable(
          "Ordinary staging returned an unknown result",
          "OrdinaryMediaStagingProtocolError",
        );
    }
    const next: number =
      stagingBatch.batchIndex === null ? 0 : stagingBatch.batchIndex + 1;
    if (
      result.nextBatchIndex !== next ||
      !Number.isInteger(result.nextBatchIndex) ||
      next > 24 ||
      !/^[a-f0-9]{64}$/u.test(result.filePlanHash) ||
      (stagingBatch.batchIndex !== null &&
        result.filePlanHash !== stagingBatch.filePlanHash)
    )
      throw ApplicationFailure.nonRetryable(
        "Ordinary staging returned invalid or noncontiguous progress",
        "OrdinaryMediaStagingProtocolError",
      );
    stagingBatch = {
      schemaVersion: 1,
      batchIndex: next,
      filePlanHash: result.filePlanHash,
    };
  }
  throw ApplicationFailure.nonRetryable(
    "Ordinary staging exceeded its complete100-member scope",
    "OrdinaryMediaStagingProtocolError",
  );
}
