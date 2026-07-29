import { z } from "zod/v4";
import {
  ChannelStateManifestSchema,
  CurrentMessageSchema,
  GuildSnapshotSchema,
  Sha256Schema,
  type CurrentMessage,
  type GuildSnapshot,
} from "#shared/glitter-corpus.ts";
import {
  LatestSnapshotPointerSchema,
  readRequiredObject,
  readVerifiedObject,
} from "./glitter-corpus-storage.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";

export const GlitterCorpusSnapshotPinSchema = z
  .object({
    snapshotId: z.uuid(),
    snapshotSha256: Sha256Schema,
  })
  .strict();
export type GlitterCorpusSnapshotPin = z.infer<
  typeof GlitterCorpusSnapshotPinSchema
>;

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
  reference: {
    snapshotId: string;
    snapshotKey: string;
    snapshotSha256: string;
  };
  snapshot: GuildSnapshot;
  messages: CurrentMessage[];
};

export type GlitterCorpusObjectReader = {
  readRequired: (key: string) => Promise<Uint8Array>;
  readVerified: (key: string, expectedSha256: string) => Promise<Uint8Array>;
};

async function resolveSnapshotReference(input: {
  guildId: string;
  snapshot: GlitterCorpusSnapshotPin | undefined;
  reader: GlitterCorpusObjectReader;
}): Promise<VerifiedGlitterCorpus["reference"]> {
  if (input.snapshot !== undefined) {
    return {
      snapshotId: input.snapshot.snapshotId,
      snapshotKey: `guilds/${input.guildId}/snapshots/${input.snapshot.snapshotId}.json`,
      snapshotSha256: input.snapshot.snapshotSha256,
    };
  }

  const pointerKey = `guilds/${input.guildId}/snapshots/latest.json`;
  const pointerBytes = await input.reader.readRequired(pointerKey);
  const pointer = LatestSnapshotPointerSchema.parse(parseJson(pointerBytes));
  if (pointer.guildId !== input.guildId) {
    throw new Error(
      `latest snapshot belongs to guild ${pointer.guildId}, expected ${input.guildId}`,
    );
  }
  return {
    snapshotId: pointer.snapshotId,
    snapshotKey: pointer.snapshotKey,
    snapshotSha256: pointer.snapshotSha256,
  };
}

export async function loadVerifiedGlitterCorpusWithReader(input: {
  guildId: string;
  snapshot?: GlitterCorpusSnapshotPin;
  reader: GlitterCorpusObjectReader;
}): Promise<VerifiedGlitterCorpus> {
  const guildId = z.string().regex(/^\d+$/u).parse(input.guildId);
  const snapshotPin =
    input.snapshot === undefined
      ? undefined
      : GlitterCorpusSnapshotPinSchema.parse(input.snapshot);
  const reference = await resolveSnapshotReference({
    guildId,
    snapshot: snapshotPin,
    reader: input.reader,
  });
  const snapshot = GuildSnapshotSchema.parse(
    parseJson(
      await input.reader.readVerified(
        reference.snapshotKey,
        reference.snapshotSha256,
      ),
    ),
  );
  if (snapshot.guildId !== guildId) {
    throw new Error(
      `snapshot ${snapshot.snapshotId} belongs to guild ${snapshot.guildId}, expected ${guildId}`,
    );
  }
  if (snapshot.snapshotId !== reference.snapshotId) {
    throw new Error(
      `snapshot object ${reference.snapshotKey} contains snapshot ${snapshot.snapshotId}`,
    );
  }

  const messages: CurrentMessage[] = [];
  const messageIds = new Set<string>();
  for (const manifestObject of snapshot.channelManifestObjects) {
    const manifest = ChannelStateManifestSchema.parse(
      parseJson(
        await input.reader.readVerified(
          manifestObject.key,
          manifestObject.sha256,
        ),
      ),
    );
    const projection = parseProjection(
      await input.reader.readVerified(
        manifest.projectionObjectKey,
        manifest.projectionSha256,
      ),
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
  return { reference, snapshot, messages };
}

export async function loadVerifiedGlitterCorpus(
  snapshot?: GlitterCorpusSnapshotPin,
): Promise<VerifiedGlitterCorpus> {
  const guildId = z
    .string()
    .regex(/^\d+$/u)
    .parse(Bun.env["GLITTER_DISCORD_GUILD_ID"]);
  const store = createCorpusStoreFromEnv();
  return await loadVerifiedGlitterCorpusWithReader({
    guildId,
    ...(snapshot === undefined ? {} : { snapshot }),
    reader: {
      readRequired: async (key) => await readRequiredObject({ store, key }),
      readVerified: async (key, expectedSha256) =>
        await readVerifiedObject({ store, key, expectedSha256 }),
    },
  });
}
