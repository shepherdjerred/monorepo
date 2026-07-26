import { z } from "zod/v4";
import {
  DiscordApiChannelSchema,
  DiscordApiMessageSchema,
  GuildInventorySchema,
  type DiscordApiChannel,
  type DiscordApiMessage,
  type GuildInventory,
} from "#shared/glitter-corpus.ts";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import { glitterCorpusDiscordRequestsTotal } from "#observability/metrics.ts";
import { canReadChannelHistory, scopeEntry } from "./glitter-corpus-scope.ts";

const API_BASE_URL = "https://discord.com/api/v10";
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_RETRIES = 8;
let globalLastRequestStartedAt = 0;
let globalBlockedUntil = 0;

const DiscordGuildSchema = z.looseObject({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  roles: z.array(
    z.looseObject({
      id: z.string().regex(/^\d+$/),
      permissions: z.string().regex(/^\d+$/),
    }),
  ),
});

const DiscordCurrentUserSchema = z.looseObject({
  id: z.string().regex(/^\d+$/),
});

const DiscordCurrentApplicationSchema = z.looseObject({
  id: z.string().regex(/^\d+$/),
  flags: z.number().int().nonnegative().optional(),
  flags_new: z.string().regex(/^\d+$/).optional(),
});

const DiscordMemberSchema = z.looseObject({
  roles: z.array(z.string().regex(/^\d+$/)),
});

const ActiveThreadListSchema = z.looseObject({
  threads: z.array(DiscordApiChannelSchema),
});

const ArchivedThreadListSchema = z.looseObject({
  threads: z.array(DiscordApiChannelSchema),
  has_more: z.boolean(),
});

const RateLimitResponseSchema = z.looseObject({
  retry_after: z.number().nonnegative(),
  global: z.boolean().optional(),
});

const JsonRecordSchema = z.record(z.string(), z.unknown());

type RateLimitMetadata = {
  limit: number | null;
  remaining: number | null;
  resetAfterSeconds: number | null;
  bucket: string | null;
};

const MESSAGE_CONTENT_FLAGS = (1n << 18n) | (1n << 19n);

export type DiscordRestResponse<T> = {
  data: T;
  rawBody: string;
  requestedAt: string;
  completedAt: string;
  retryCount: number;
  rateLimit: RateLimitMetadata;
};

function parseNullableIntegerHeader(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNullableNumberHeader(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rateLimitMetadata(headers: Headers): RateLimitMetadata {
  return {
    limit: parseNullableIntegerHeader(headers.get("x-ratelimit-limit")),
    remaining: parseNullableIntegerHeader(headers.get("x-ratelimit-remaining")),
    resetAfterSeconds: parseNullableNumberHeader(
      headers.get("x-ratelimit-reset-after"),
    ),
    bucket: headers.get("x-ratelimit-bucket"),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new Error("Discord returned invalid JSON", { cause: error });
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

export function requireMessageContentIntent(input: {
  applicationId: string;
  botUserId: string;
  flags?: number;
  flagsNew?: string;
}): void {
  if (input.applicationId !== input.botUserId) {
    throw new Error(
      `Discord application ${input.applicationId} does not match bot user ${input.botUserId}`,
    );
  }
  const flags =
    input.flagsNew === undefined
      ? input.flags === undefined
        ? undefined
        : BigInt(input.flags)
      : BigInt(input.flagsNew);
  if (flags === undefined || (flags & MESSAGE_CONTENT_FLAGS) === 0n) {
    throw new Error(
      "Discord Message Content intent is not enabled; refusing to capture empty content fields",
    );
  }
}

export class DiscordRestClient {
  readonly #token: string;

  public constructor(token: string) {
    if (token === "") {
      throw new Error("Discord archival bot token must not be empty");
    }
    this.#token = token;
  }

  async #waitForGlobalCeiling(): Promise<void> {
    const nextRequestAt = Math.max(
      globalLastRequestStartedAt + MIN_REQUEST_INTERVAL_MS,
      globalBlockedUntil,
    );
    const delay = nextRequestAt - Date.now();
    if (delay > 0) {
      await Bun.sleep(delay);
    }
    globalLastRequestStartedAt = Date.now();
  }

  async get<T>(
    path: string,
    schema: z.ZodType<T>,
  ): Promise<DiscordRestResponse<T>> {
    if (!path.startsWith("/")) {
      throw new Error(`Discord REST path must start with "/": ${path}`);
    }

    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      await this.#waitForGlobalCeiling();
      const requestedAt = new Date().toISOString();
      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}${path}`, {
          headers: { Authorization: `Bot ${this.#token}` },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error: unknown) {
        if (attempt === MAX_RETRIES) {
          glitterCorpusDiscordRequestsTotal.inc({
            outcome: "fatal-network-error",
          });
          throw new Error(
            `Discord request failed after ${String(attempt + 1)} attempts: ${path}`,
            { cause: error },
          );
        }
        glitterCorpusDiscordRequestsTotal.inc({
          outcome: "retryable-network-error",
        });
        await Bun.sleep(retryDelayMs(attempt));
        attempt += 1;
        continue;
      }
      const completedAt = new Date().toISOString();
      const body = await response.text();
      const metadata = rateLimitMetadata(response.headers);
      if (metadata.remaining === 0 && metadata.resetAfterSeconds !== null) {
        globalBlockedUntil = Math.max(
          globalBlockedUntil,
          Date.now() + Math.ceil(metadata.resetAfterSeconds * 1000),
        );
      }

      if (response.status === 401 || response.status === 403) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "auth-failure" });
        throw new Error(
          `Discord authorization failed with ${String(response.status)} for ${path}; refusing to continue because corpus completeness cannot be proven`,
        );
      }
      if (response.ok) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "success" });
        return {
          data: schema.parse(parseJson(body)),
          rawBody: body,
          requestedAt,
          completedAt,
          retryCount: attempt,
          rateLimit: metadata,
        };
      }
      if (!isRetryableStatus(response.status) || attempt === MAX_RETRIES) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "fatal-error" });
        throw new Error(
          `Discord request failed with ${String(response.status)} for ${path}: ${body.slice(0, 500)}`,
        );
      }

      if (response.status === 429) {
        glitterCorpusDiscordRequestsTotal.inc({ outcome: "rate-limited" });
        const limited = RateLimitResponseSchema.parse(parseJson(body));
        const retryDelay = Math.ceil(limited.retry_after * 1000);
        globalBlockedUntil = Math.max(
          globalBlockedUntil,
          Date.now() + retryDelay,
        );
        await Bun.sleep(retryDelay);
      } else {
        glitterCorpusDiscordRequestsTotal.inc({
          outcome: "retryable-server-error",
        });
        await Bun.sleep(retryDelayMs(attempt));
      }
      attempt += 1;
    }

    throw new Error(`Discord retry loop exhausted unexpectedly for ${path}`);
  }

  async getMessages(input: {
    channelId: string;
    before?: string;
    after?: string;
  }): Promise<DiscordRestResponse<DiscordApiMessage[]>> {
    if (input.before !== undefined && input.after !== undefined) {
      throw new Error("Discord messages request cannot set before and after");
    }
    const query = new URLSearchParams({ limit: "100" });
    if (input.before !== undefined) {
      query.set("before", input.before);
    }
    if (input.after !== undefined) {
      query.set("after", input.after);
    }
    return await this.get(
      `/channels/${input.channelId}/messages?${query.toString()}`,
      z.array(DiscordApiMessageSchema),
    );
  }
}

async function listArchivedPublicThreads(
  client: DiscordRestClient,
  parentChannelId: string,
): Promise<DiscordApiChannel[]> {
  const threads: DiscordApiChannel[] = [];
  let before: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: "100" });
    if (before !== undefined) {
      query.set("before", before);
    }
    const page = await client.get(
      `/channels/${parentChannelId}/threads/archived/public?${query.toString()}`,
      ArchivedThreadListSchema,
    );
    threads.push(...page.data.threads);
    if (!page.data.has_more) {
      return threads;
    }
    const last = page.data.threads.at(-1);
    const cursor = last?.thread_metadata?.archive_timestamp;
    if (cursor === undefined) {
      throw new Error(
        `Discord archived-thread page for ${parentChannelId} has_more but no archive timestamp cursor`,
      );
    }
    before = cursor;
  }
}

function permissionChannelFor(
  channel: DiscordApiChannel,
  channelsById: ReadonlyMap<string, DiscordApiChannel>,
): DiscordApiChannel {
  if (channel.type !== 10 && channel.type !== 11) {
    return channel;
  }
  const parentId = channel.parent_id;
  if (parentId === undefined || parentId === null) {
    throw new Error(`public thread ${channel.id} has no parent channel ID`);
  }
  const parent = channelsById.get(parentId);
  if (parent === undefined) {
    throw new Error(
      `public thread ${channel.id} has no discoverable parent ${parentId}`,
    );
  }
  return parent;
}

export async function discoverGuildInventory(input: {
  token: string;
  guildId: string;
  guildSlug: string;
  denylistedChannelIds: readonly string[];
  discoveredAt: string;
}): Promise<GuildInventory> {
  const client = new DiscordRestClient(input.token);
  // Deliberately sequential: the same one-request-per-second ceiling applies
  // during inventory, not only during message pagination.
  const guildResponse = await client.get(
    `/guilds/${input.guildId}`,
    DiscordGuildSchema,
  );
  const userResponse = await client.get("/users/@me", DiscordCurrentUserSchema);
  const applicationResponse = await client.get(
    "/oauth2/applications/@me",
    DiscordCurrentApplicationSchema,
  );
  requireMessageContentIntent({
    applicationId: applicationResponse.data.id,
    botUserId: userResponse.data.id,
    ...(applicationResponse.data.flags === undefined
      ? {}
      : { flags: applicationResponse.data.flags }),
    ...(applicationResponse.data.flags_new === undefined
      ? {}
      : { flagsNew: applicationResponse.data.flags_new }),
  });
  const memberResponse = await client.get(
    `/guilds/${input.guildId}/members/@me`,
    DiscordMemberSchema,
  );
  const channelsResponse = await client.get(
    `/guilds/${input.guildId}/channels`,
    z.array(DiscordApiChannelSchema),
  );
  const active = await client.get(
    `/guilds/${input.guildId}/threads/active`,
    ActiveThreadListSchema,
  );

  const denylist = new Set(input.denylistedChannelIds);
  const parentChannels = channelsResponse.data.filter((channel) => {
    const supportsPublicThreads =
      channel.type === 0 ||
      channel.type === 5 ||
      channel.type === 15 ||
      channel.type === 16;
    return (
      supportsPublicThreads &&
      !denylist.has(channel.id) &&
      canReadChannelHistory({
        guildId: input.guildId,
        botUserId: userResponse.data.id,
        roleIds: memberResponse.data.roles,
        guildRoles: guildResponse.data.roles,
        channel,
      })
    );
  });
  const archivedPages: DiscordApiChannel[][] = [];
  for (const parent of parentChannels) {
    archivedPages.push(await listArchivedPublicThreads(client, parent.id));
  }

  const byId = new Map<string, DiscordApiChannel>();
  for (const channel of [
    ...channelsResponse.data,
    ...active.data.threads,
    ...archivedPages.flat(),
  ]) {
    byId.set(channel.id, channel);
  }
  const entries = [...byId.values()]
    .map((channel) => {
      return scopeEntry({
        guildId: input.guildId,
        botUserId: userResponse.data.id,
        memberRoleIds: memberResponse.data.roles,
        guildRoles: guildResponse.data.roles,
        denylist,
        discoveredAt: input.discoveredAt,
        channel,
        permissionChannel: permissionChannelFor(channel, byId),
      });
    })
    .toSorted((left, right) => left.channelId.localeCompare(right.channelId));

  const unsigned = {
    schemaVersion: 1,
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    guildName: guildResponse.data.name,
    discoveredAt: input.discoveredAt,
    denylistedChannelIds: [...denylist].toSorted(),
    entries,
  };
  return GuildInventorySchema.parse({
    ...unsigned,
    sha256: sha256(JSON.stringify(unsigned)),
  });
}

export function normalizeDiscordMessage(input: {
  message: DiscordApiMessage;
  guildId: string;
  guildSlug: string;
  sourceKey: string;
  observedAt: string;
}) {
  const message = DiscordApiMessageSchema.parse(input.message);
  return {
    schemaVersion: 1,
    source: "discord-rest",
    sourceKey: input.sourceKey,
    observedAt: input.observedAt,
    guildId: input.guildId,
    guildSlug: input.guildSlug,
    channelId: message.channel_id,
    messageId: message.id,
    author: {
      id: message.author.id,
      username: message.author.username,
      globalName: message.author.global_name ?? null,
      discriminator: message.author.discriminator,
      bot: message.author.bot ?? false,
      avatar: message.author.avatar ?? null,
    },
    content: message.content,
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp,
    type: message.type,
    flags: String(message.flags ?? 0),
    pinned: message.pinned,
    tts: message.tts,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      size: attachment.size,
      url: attachment.url,
      proxyUrl: attachment.proxy_url,
      contentType: attachment.content_type ?? null,
      height: attachment.height ?? null,
      width: attachment.width ?? null,
      description: attachment.description ?? null,
      ephemeral: attachment.ephemeral ?? false,
    })),
    referencedMessageId: message.message_reference?.message_id ?? null,
    raw: JsonRecordSchema.parse(message),
  };
}
