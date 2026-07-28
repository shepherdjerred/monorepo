import { z } from "zod/v4";
import {
  ChannelStateManifestSchema,
  CurrentMessageSchema,
  GuildSnapshotSchema,
  type CurrentMessage,
  type GuildSnapshot,
} from "#shared/glitter-corpus.ts";
import {
  LatestSnapshotPointerSchema,
  readRequiredObject,
  readVerifiedObject,
  type LatestSnapshotPointer,
} from "./glitter-corpus-storage.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function parseProjection(bytes: Uint8Array): CurrentMessage[] {
  return new TextDecoder()
    .decode(bytes)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => CurrentMessageSchema.parse(JSON.parse(line)));
}

export type VerifiedGlitterCorpus = {
  pointer: LatestSnapshotPointer;
  snapshot: GuildSnapshot;
  messages: CurrentMessage[];
};

export async function loadVerifiedGlitterCorpus(): Promise<VerifiedGlitterCorpus> {
  const guildId = z
    .string()
    .regex(/^\d+$/u)
    .parse(Bun.env["GLITTER_DISCORD_GUILD_ID"]);
  const store = createCorpusStoreFromEnv();
  const pointerKey = `guilds/${guildId}/snapshots/latest.json`;
  const pointerBytes = await readRequiredObject({ store, key: pointerKey });
  const pointer = LatestSnapshotPointerSchema.parse(parseJson(pointerBytes));
  if (pointer.guildId !== guildId) {
    throw new Error(
      `latest snapshot belongs to guild ${pointer.guildId}, expected ${guildId}`,
    );
  }
  const snapshot = GuildSnapshotSchema.parse(
    parseJson(
      await readVerifiedObject({
        store,
        key: pointer.snapshotKey,
        expectedSha256: pointer.snapshotSha256,
      }),
    ),
  );

  const messages: CurrentMessage[] = [];
  const messageIds = new Set<string>();
  for (const manifestObject of snapshot.channelManifestObjects) {
    const manifest = ChannelStateManifestSchema.parse(
      parseJson(
        await readVerifiedObject({
          store,
          key: manifestObject.key,
          expectedSha256: manifestObject.sha256,
        }),
      ),
    );
    const projection = parseProjection(
      await readVerifiedObject({
        store,
        key: manifest.projectionObjectKey,
        expectedSha256: manifest.projectionSha256,
      }),
    );
    if (projection.length !== manifest.uniqueMessageCount) {
      throw new Error(
        `projection count mismatch for channel ${manifest.channelId}`,
      );
    }
    for (const message of projection) {
      if (message.guildId !== snapshot.guildId) {
        throw new Error(
          `projection message ${message.messageId} has the wrong guild`,
        );
      }
      if (message.channelId !== manifest.channelId) {
        throw new Error(
          `projection message ${message.messageId} has the wrong channel`,
        );
      }
      if (messageIds.has(message.messageId)) {
        throw new Error(
          `duplicate message ${message.messageId} across verified projections`,
        );
      }
      messageIds.add(message.messageId);
      messages.push(message);
    }
  }
  if (messages.length !== snapshot.uniqueMessageCount) {
    throw new Error(
      `snapshot count mismatch: expected ${String(snapshot.uniqueMessageCount)}, verified ${String(messages.length)}`,
    );
  }
  return { pointer, snapshot, messages };
}
