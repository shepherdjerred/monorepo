import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import { loadStateManifest } from "./glitter-corpus-io.ts";
import { createCorpusStoresFromEnv } from "./glitter-corpus-store.ts";
import { readMirroredObject } from "./glitter-corpus-storage.ts";

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
  const bytes = await readMirroredObject({
    stores: createCorpusStoresFromEnv(),
    key: baseline.projectionObjectKey,
  });
  if (bytes === undefined) {
    throw new Error(
      `baseline projection missing: ${baseline.projectionObjectKey}`,
    );
  }
  if (sha256(bytes) !== baseline.projectionSha256) {
    throw new Error(
      `baseline projection checksum mismatch: ${baseline.projectionObjectKey}`,
    );
  }
  const messages = new TextDecoder()
    .decode(bytes)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => CurrentMessageSchema.parse(JSON.parse(line)));
  return { baseline, messages };
}
