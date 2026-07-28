import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import { loadStateManifest } from "./glitter-corpus-io.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import { readVerifiedObject } from "./glitter-corpus-storage.ts";

export async function readBaselineProjection(input: {
  manifestKey: string;
  guildId: string;
  channelId: string;
}) {
  const baseline = await loadStateManifest(input.manifestKey);
  if (
    baseline.guildId !== input.guildId ||
    baseline.channelId !== input.channelId
  ) {
    throw new Error(`baseline state identity mismatch for ${input.channelId}`);
  }
  const bytes = await readVerifiedObject({
    store: createCorpusStoreFromEnv(),
    key: baseline.projectionObjectKey,
    expectedSha256: baseline.projectionSha256,
  });
  const messages = new TextDecoder()
    .decode(bytes)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => CurrentMessageSchema.parse(JSON.parse(line)));
  return { baseline, messages };
}
