import type { z } from "zod";
import type { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";
import { fixtureId } from "#testing/fixture-api/support.ts";

type Inventory = z.input<typeof NativeRecoveryInventorySchema>;

/**
 * What the recovery inventory knows: the runtime's mode and epoch, the restore
 * that is being reproved, and the files and reviews it lists.
 */
export function nativeRecoveryInventory(): Inventory {
  return {
    nextCursor: null,
    prerequisites: [],
    runtime: { mode: "active", recoveryEpoch: 1, version: 12 },
    restoreOperationId: fixtureId(33, 1),
    assets: [],
    plans: [],
  };
}
