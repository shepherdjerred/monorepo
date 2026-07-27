import { verifyLatestGlitterCorpusSnapshot } from "#activities/glitter-corpus-recovery.ts";

console.warn(
  JSON.stringify(await verifyLatestGlitterCorpusSnapshot(), null, 2),
);
