import { ApplicationFailure } from "@temporalio/activity";
import { rm } from "node:fs/promises";

function cleanupError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Agent chat runtime cleanup failed");
}

export async function cleanupAgentChatRuntime(input: {
  root: string;
  publicationComplete: boolean;
  terminateProviderSubprocesses: () => Promise<void>;
}): Promise<void> {
  const failures: Error[] = [];
  try {
    await input.terminateProviderSubprocesses();
  } catch (error: unknown) {
    failures.push(cleanupError(error));
  }
  try {
    await rm(input.root, { recursive: true, force: true });
  } catch (error: unknown) {
    failures.push(cleanupError(error));
  }
  if (failures.length === 0) return;
  const firstFailure = failures[0];
  if (firstFailure === undefined) {
    throw new Error("Agent chat runtime cleanup failed without an error");
  }
  const failure =
    failures.length === 1
      ? firstFailure
      : new AggregateError(failures, "Agent chat runtime cleanup failed");
  if (input.publicationComplete) {
    throw ApplicationFailure.create({
      message: "Agent chat cleanup failed after durable publication",
      cause: failure,
      nonRetryable: false,
      type: "AgentChatPostPublicationCleanupFailure",
    });
  }
  throw failure;
}
