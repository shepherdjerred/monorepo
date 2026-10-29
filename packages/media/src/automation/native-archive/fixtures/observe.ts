import { expect } from "vitest";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { createNativePlexObserver } from "#migration/native-plex/review.ts";
import { observePairedArchiveCleanup } from "#migration/native-plex/archive.ts";
import type { NativePlexContext } from "#migration/native-plex/producer.ts";
import type { CleanupNativeArchiveInput } from "#shared/native-recovery/archive.ts";

/** Execute the real paired producer for the exact service-issued command. */
export function archiveReviewObserver(context: NativePlexContext) {
  return (input: { planId: string; operationId: string }) =>
    createNativePlexObserver(context)(input, bindingTestExecution());
}

/** Fixture preparation must establish authority before testing a later effect boundary. */
export async function observeArchiveCleanup(
  context: NativePlexContext,
  input: CleanupNativeArchiveInput,
) {
  expect(
    await observePairedArchiveCleanup(context, input, bindingTestExecution()),
  ).toEqual({ status: "ready" });
}
