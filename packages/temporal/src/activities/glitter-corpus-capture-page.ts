import { z } from "zod/v4";
import {
  DiscordApiMessageSchema,
  DiscordRateLimitSchema,
  IsoTimestampSchema,
} from "#shared/glitter-corpus.ts";
import type { CapturePageInput } from "./glitter-corpus-activity-types.ts";
import type {
  DiscordRestClient,
  DiscordRestResponse,
} from "./glitter-corpus-discord-client.ts";
import { jsonBytes } from "./glitter-corpus-io.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import { putImmutableObject, readObject } from "./glitter-corpus-storage.ts";

const PersistedDiscordResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    retryCount: z.number().int().nonnegative(),
    rateLimit: DiscordRateLimitSchema,
    rawBody: z.string(),
  })
  .strict();

function restoreDiscordResponse(
  bytes: Uint8Array,
): DiscordRestResponse<z.infer<typeof DiscordApiMessageSchema>[]> {
  const persisted = PersistedDiscordResponseSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  return {
    data: z.array(DiscordApiMessageSchema).parse(JSON.parse(persisted.rawBody)),
    rawBody: persisted.rawBody,
    requestedAt: persisted.requestedAt,
    completedAt: persisted.completedAt,
    retryCount: persisted.retryCount,
    rateLimit: persisted.rateLimit,
  };
}

export async function readOrCaptureDiscordPage(input: {
  request: CapturePageInput;
  client: DiscordRestClient;
}): Promise<DiscordRestResponse<z.infer<typeof DiscordApiMessageSchema>[]>> {
  const responseKey =
    `guilds/${input.request.guildId}/channels/${input.request.channelId}/` +
    `responses/${input.request.direction}/${input.request.requestId}.json`;
  const store = createCorpusStoreFromEnv();
  const persisted = await readObject({
    store,
    key: responseKey,
  });
  if (persisted !== undefined) {
    return restoreDiscordResponse(persisted);
  }
  const response = await input.client.getMessages({
    channelId: input.request.channelId,
    ...(input.request.before === undefined
      ? {}
      : { before: input.request.before }),
    ...(input.request.after === undefined
      ? {}
      : { after: input.request.after }),
  });
  await putImmutableObject({
    store,
    key: responseKey,
    body: jsonBytes({
      schemaVersion: 1,
      requestedAt: response.requestedAt,
      completedAt: response.completedAt,
      retryCount: response.retryCount,
      rateLimit: response.rateLimit,
      rawBody: response.rawBody,
    }),
    contentType: "application/json",
    writtenAt: response.completedAt,
  });
  return response;
}
