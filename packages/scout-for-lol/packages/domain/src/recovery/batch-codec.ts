import { defineVersionedCodec } from "#src/codec/versioned.ts";
import { RecoveryBatchSchema } from "#src/recovery/batch.ts";

/**
 * Wire codec for a persisted recovery batch. The envelope is
 * `{ kind: "recovery-batch", version, data }`; older versions migrate forward
 * inside `parse`.
 */
export const recoveryBatchCodec = defineVersionedCodec({
  kind: "recovery-batch",
  version: 1,
  schema: RecoveryBatchSchema,
});
