import { ApplicationFailure } from "@temporalio/workflow";

export function traversalSafetyCeiling(message: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(
    message,
    "GlitterCorpusTraversalSafetyCeilingExceeded",
  );
}

export function invalidInput(message: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(message, "GlitterCorpusInvalidInput");
}
