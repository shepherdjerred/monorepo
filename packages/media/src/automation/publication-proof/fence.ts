import type { Transaction } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";

/** Ordinary effects only; the exact compensation executor has its own purpose-bound authority. */
export async function assertPublicationUnfenced(
  tx: Transaction,
  mediaIds: readonly string[],
  assetIds: readonly string[] = [],
): Promise<void> {
  try {
    await assertNoPublicationCompensationFence(tx, { mediaIds, assetIds });
  } catch (error) {
    if (
      error instanceof NativeCompensationProtection &&
      error.reason === "publication_compensation_fence_active"
    )
      throw new FileGuardError(error.reason);
    throw error;
  }
}
