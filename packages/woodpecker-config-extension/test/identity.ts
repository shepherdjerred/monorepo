import type { PipelineIdentity } from "#src/pipeline/emit.ts";

/**
 * Pipeline identity used by emitter tests.
 *
 * Every field is stamped onto the generated pod metadata, so the values are
 * deliberately distinguishable from one another: a test asserting on the
 * commit label would still pass if the emitter wrote the branch there.
 */
export const TEST_IDENTITY: PipelineIdentity = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  branch: "feature/telemetry",
  linkUrl: "https://github.com/shepherdjerred/monorepo/commit/0123456789ab",
};
