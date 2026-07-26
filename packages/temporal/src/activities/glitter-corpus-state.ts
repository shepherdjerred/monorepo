import type {
  ChannelStateManifest,
  CurrentMessage,
} from "#shared/glitter-corpus.ts";
import { projectionChecksum } from "#shared/glitter-corpus-projection.ts";
import type { ChannelStateResult } from "./glitter-corpus-activity-types.ts";
import { writeChannelState } from "./glitter-corpus-io.ts";

export function projectionStateFields(input: {
  projection: readonly CurrentMessage[];
  projectionObjectKey: string;
}): {
  uniqueMessageCount: number;
  oldestMessageId: string | null;
  newestMessageId: string | null;
  projectionObjectKey: string;
  projectionSha256: string;
  complete: true;
} {
  return {
    uniqueMessageCount: input.projection.length,
    oldestMessageId: input.projection[0]?.messageId ?? null,
    newestMessageId: input.projection.at(-1)?.messageId ?? null,
    projectionObjectKey: input.projectionObjectKey,
    projectionSha256: projectionChecksum(input.projection),
    complete: true,
  };
}

export async function persistProjectionState(input: {
  identity: {
    guildId: string;
    channelId: string;
    snapshotId: string;
    verifiedAt: string;
  };
  manifest: ChannelStateManifest;
  projection: readonly CurrentMessage[];
}): Promise<ChannelStateResult> {
  return await writeChannelState({
    guildId: input.identity.guildId,
    channelId: input.identity.channelId,
    snapshotId: input.identity.snapshotId,
    manifest: input.manifest,
    writtenAt: input.identity.verifiedAt,
    uniqueMessageCount: input.projection.length,
  });
}
