import { z } from "zod/v4";
import {
  DiscordApiChannelSchema,
  GuildInventorySchema,
  type DiscordApiChannel,
  type GuildInventory,
} from "#shared/glitter-corpus.ts";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import { canReadChannelHistory, scopeEntry } from "./glitter-corpus-scope.ts";
import {
  DiscordRestClient,
  requireMessageContentIntent,
  type DiscordRestClientHooks,
} from "./glitter-corpus-discord-client.ts";

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

function supportsPublicThreads(channel: DiscordApiChannel): boolean {
  return (
    channel.type === 0 ||
    channel.type === 5 ||
    channel.type === 15 ||
    channel.type === 16
  );
}

export function discordGuildMemberPath(input: {
  guildId: string;
  botUserId: string;
}): string {
  return `/guilds/${input.guildId}/members/${input.botUserId}`;
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

export function assertPreviouslyCapturedThreadParentsReadable(input: {
  guildId: string;
  botUserId: string;
  roleIds: readonly string[];
  guildRoles: readonly { id: string; permissions: string }[];
  denylist: ReadonlySet<string>;
  baselineInventory: GuildInventory | undefined;
  channelsById: ReadonlyMap<string, DiscordApiChannel>;
}): void {
  if (input.baselineInventory === undefined) {
    return;
  }
  const parentIds = new Set(
    input.baselineInventory.entries
      .filter(
        (entry) =>
          entry.scopeDecision === "include" &&
          (entry.type === 10 || entry.type === 11) &&
          entry.parentId !== null,
      )
      .map((entry) => entry.parentId)
      .filter((parentId) => parentId !== null),
  );
  for (const parentId of parentIds) {
    if (input.denylist.has(parentId)) {
      continue;
    }
    const parent = input.channelsById.get(parentId);
    if (parent === undefined) {
      throw new Error(
        `previously captured public-thread parent ${parentId} is no longer discoverable`,
      );
    }
    if (!supportsPublicThreads(parent)) {
      throw new Error(
        `previously captured public-thread parent ${parentId} no longer supports archived public-thread discovery`,
      );
    }
    if (
      !canReadChannelHistory({
        guildId: input.guildId,
        botUserId: input.botUserId,
        roleIds: input.roleIds,
        guildRoles: input.guildRoles,
        channel: parent,
      })
    ) {
      throw new Error(
        `lost Discord history permission for previously captured public-thread parent ${parentId}`,
      );
    }
  }
}

export async function discoverGuildInventory(input: {
  token: string;
  guildId: string;
  guildSlug: string;
  denylistedChannelIds: readonly string[];
  discoveredAt: string;
  baselineInventory?: GuildInventory;
  hooks?: DiscordRestClientHooks;
}): Promise<GuildInventory> {
  const client = new DiscordRestClient(input.token, input.hooks);
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
    discordGuildMemberPath({
      guildId: input.guildId,
      botUserId: userResponse.data.id,
    }),
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
  const guildChannelsById = new Map(
    channelsResponse.data.map((channel) => [channel.id, channel]),
  );
  assertPreviouslyCapturedThreadParentsReadable({
    guildId: input.guildId,
    botUserId: userResponse.data.id,
    roleIds: memberResponse.data.roles,
    guildRoles: guildResponse.data.roles,
    denylist,
    baselineInventory: input.baselineInventory,
    channelsById: guildChannelsById,
  });
  const parentChannels = channelsResponse.data.filter((channel) => {
    return (
      supportsPublicThreads(channel) &&
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
