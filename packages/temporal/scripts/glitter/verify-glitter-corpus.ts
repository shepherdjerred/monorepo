import { verifyLatestGlitterCorpusSnapshot } from "#activities/glitter/corpus/glitter-corpus-recovery.ts";

console.warn(
  JSON.stringify(await verifyLatestGlitterCorpusSnapshot(), null, 2),
);
