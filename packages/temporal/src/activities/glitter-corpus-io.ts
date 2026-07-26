import { z } from "zod/v4";
import {
  ChannelStateManifestSchema,
  CorpusObservationSchema,
  DiscordApiMessageSchema,
  PageManifestSchema,
  SeedImportManifestSchema,
  type ChannelStateManifest,
  type CorpusObservation,
  type PageManifest,
} from "#shared/glitter-corpus.ts";
import {
  compareSnowflakes,
  sha256,
} from "#shared/glitter-corpus-projection.ts";
import { normalizeDiscordMessage } from "./glitter-corpus-normalize.ts";
import { assertDiscordPageOrder } from "./glitter-corpus-page-order.ts";
import {
  createCorpusStoresFromEnv,
  putMirroredImmutableObject,
  readMirroredObject,
  readVerifiedMirroredObject,
} from "./glitter-corpus-storage.ts";
import { ChannelStateResultSchema } from "./glitter-corpus-activity-types.ts";

export function requireGlitterCorpusEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the Glitter Discord corpus`);
  }
  return value;
}

function parseDenylist(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return z
    .array(z.string().regex(/^\d+$/))
    .parse(value.split(",").map((entry) => entry.trim()));
}

export function glitterCorpusRuntimeConfig(): {
  token: string;
  guildId: string;
  guildSlug: string;
  denylistedChannelIds: string[];
} {
  return {
    token: requireGlitterCorpusEnv("GLITTER_DISCORD_TOKEN"),
    guildId: z
      .string()
      .regex(/^\d+$/)
      .parse(requireGlitterCorpusEnv("GLITTER_DISCORD_GUILD_ID")),
    guildSlug: requireGlitterCorpusEnv("GLITTER_DISCORD_GUILD_SLUG"),
    denylistedChannelIds: parseDenylist(
      Bun.env["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"],
    ),
  };
}

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function parseNdjson(
  bytes: Uint8Array,
  schema: z.ZodType<CorpusObservation>,
): CorpusObservation[] {
  return new TextDecoder()
    .decode(bytes)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => schema.parse(JSON.parse(line)));
}

export async function readCorpusJson<T>(
  key: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const stores = createCorpusStoresFromEnv();
  const bytes = await readMirroredObject({ stores, key });
  if (bytes === undefined) {
    throw new Error(`mirrored corpus object does not exist: ${key}`);
  }
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function readCorpusPage(
  key: string,
  expectedDirection: "backward" | "forward" | "daily-overlap",
): Promise<{
  manifest: PageManifest;
  messages: z.infer<typeof DiscordApiMessageSchema>[];
}> {
  const manifest = await readCorpusJson(key, PageManifestSchema);
  if (manifest.direction !== expectedDirection) {
    throw new Error(
      `page manifest ${key} has direction ${manifest.direction}, expected ${expectedDirection}`,
    );
  }
  const stores = createCorpusStoresFromEnv();
  const bytes = await readMirroredObject({
    stores,
    key: manifest.rawObjectKey,
  });
  if (bytes === undefined) {
    throw new Error(`raw Discord page is missing: ${manifest.rawObjectKey}`);
  }
  if (sha256(bytes) !== manifest.rawSha256) {
    throw new Error(
      `raw Discord page checksum mismatch: ${manifest.rawObjectKey}`,
    );
  }
  const messages = z
    .array(DiscordApiMessageSchema)
    .parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (messages.length !== manifest.responseCount) {
    throw new Error(
      `page count mismatch for ${key}: manifest ${String(manifest.responseCount)}, raw ${String(messages.length)}`,
    );
  }
  if (
    (messages[0]?.id ?? null) !== manifest.firstMessageId ||
    (messages.at(-1)?.id ?? null) !== manifest.lastMessageId
  ) {
    throw new Error(`page boundary IDs do not match manifest ${key}`);
  }
  for (const message of messages) {
    if (message.channel_id !== manifest.channelId) {
      throw new Error(
        `raw Discord page ${manifest.rawObjectKey} contains message ${message.id} from channel ${message.channel_id}`,
      );
    }
  }
  assertDiscordPageOrder({
    messageIds: messages.map((message) => message.id),
    direction: expectedDirection,
    objectKey: manifest.rawObjectKey,
  });
  return { manifest, messages };
}

export function normalizePageObservations(input: {
  page: Awaited<ReturnType<typeof readCorpusPage>>;
  guildId: string;
  guildSlug: string;
}): CorpusObservation[] {
  return input.page.messages.map((message) =>
    CorpusObservationSchema.parse(
      normalizeDiscordMessage({
        message,
        guildId: input.guildId,
        guildSlug: input.guildSlug,
        sourceKey: `${input.page.manifest.rawObjectKey}#message=${message.id}`,
        observedAt: input.page.manifest.completedAt,
      }),
    ),
  );
}

function assertTraversalPage(input: {
  key: string;
  page: Awaited<ReturnType<typeof readCorpusPage>>;
  guildId: string;
  channelId: string;
  direction: "backward" | "forward";
  expectedCursor: string | undefined;
}): void {
  if (
    input.page.manifest.guildId !== input.guildId ||
    input.page.manifest.channelId !== input.channelId
  ) {
    throw new Error(`page manifest identity mismatch: ${input.key}`);
  }
  const actualCursor =
    input.direction === "backward"
      ? input.page.manifest.before
      : input.page.manifest.after;
  if (actualCursor !== (input.expectedCursor ?? null)) {
    throw new Error(
      `${input.direction} traversal cursor mismatch at ${input.key}: expected ${input.expectedCursor ?? "none"}, received ${actualCursor ?? "none"}`,
    );
  }
}

function traversalTerminalReason(input: {
  terminal: PageManifest;
  direction: "backward" | "forward";
  reachedUpperBound: boolean;
}): "empty-channel" | "reached-upper-bound" | undefined {
  if (input.terminal.responseCount === 0) {
    return "empty-channel";
  }
  return input.reachedUpperBound && input.direction === "forward"
    ? "reached-upper-bound"
    : undefined;
}

export async function readTraversal(input: {
  guildId: string;
  guildSlug: string;
  channelId: string;
  direction: "backward" | "forward";
  initialAfter?: string;
  upperBoundInclusive?: string;
  pageManifestKeys: readonly string[];
}): Promise<{
  observations: CorpusObservation[];
  messageIds: string[];
  terminal: PageManifest;
  terminalReason: "empty-channel" | "reached-upper-bound";
}> {
  if (
    input.direction === "backward" &&
    (input.initialAfter !== undefined ||
      input.upperBoundInclusive !== undefined)
  ) {
    throw new Error("backward traversal cannot have forward-only boundaries");
  }
  const observations: CorpusObservation[] = [];
  const messageIds: string[] = [];
  let terminal: PageManifest | undefined;
  let reachedUpperBound = false;
  let expectedCursor = input.initialAfter;
  for (const key of input.pageManifestKeys) {
    const page = await readCorpusPage(key, input.direction);
    assertTraversalPage({
      key,
      page,
      guildId: input.guildId,
      channelId: input.channelId,
      direction: input.direction,
      expectedCursor,
    });
    terminal = page.manifest;
    const upperBound = input.upperBoundInclusive;
    const boundedMessages =
      upperBound === undefined
        ? page.messages
        : page.messages.filter(
            (message) => compareSnowflakes(message.id, upperBound) <= 0,
          );
    for (const message of boundedMessages) {
      messageIds.push(message.id);
    }
    const pageObservations = normalizePageObservations({
      page,
      guildId: input.guildId,
      guildSlug: input.guildSlug,
    });
    const boundedIds = new Set(boundedMessages.map((message) => message.id));
    observations.push(
      ...pageObservations.filter((observation) =>
        boundedIds.has(observation.messageId),
      ),
    );
    if (
      upperBound !== undefined &&
      page.messages.some(
        (message) => compareSnowflakes(message.id, upperBound) >= 0,
      )
    ) {
      reachedUpperBound = true;
    }
    expectedCursor = page.messages.at(-1)?.id ?? expectedCursor;
  }
  if (terminal === undefined) {
    throw new Error(
      `${input.direction} traversal for ${input.channelId} has no pages`,
    );
  }
  const terminalReason = traversalTerminalReason({
    terminal,
    direction: input.direction,
    reachedUpperBound,
  });
  if (terminalReason === undefined) {
    throw new Error(
      `${input.direction} traversal for ${input.channelId} has no valid terminal proof`,
    );
  }
  if (new Set(messageIds).size !== messageIds.length) {
    throw new Error(
      `${input.direction} traversal for ${input.channelId} contains duplicate message IDs`,
    );
  }
  return { observations, messageIds, terminal, terminalReason };
}

export async function readOverlapTraversal(input: {
  guildId: string;
  guildSlug: string;
  channelId: string;
  pageManifestKeys: readonly string[];
}): Promise<{
  observations: CorpusObservation[];
  messageIds: string[];
  timestamps: string[];
  terminal: PageManifest;
}> {
  const observations: CorpusObservation[] = [];
  const messageIds: string[] = [];
  const timestamps: string[] = [];
  let terminal: PageManifest | undefined;
  let expectedBefore: string | undefined;
  for (const key of input.pageManifestKeys) {
    const page = await readCorpusPage(key, "daily-overlap");
    if (
      page.manifest.guildId !== input.guildId ||
      page.manifest.channelId !== input.channelId
    ) {
      throw new Error(`overlap page manifest identity mismatch: ${key}`);
    }
    if (page.manifest.before !== (expectedBefore ?? null)) {
      throw new Error(`overlap page cursor mismatch at ${key}`);
    }
    terminal = page.manifest;
    messageIds.push(...page.messages.map((message) => message.id));
    timestamps.push(...page.messages.map((message) => message.timestamp));
    observations.push(
      ...normalizePageObservations({
        page,
        guildId: input.guildId,
        guildSlug: input.guildSlug,
      }),
    );
    if (page.messages.length > 0) {
      expectedBefore = page.messages.at(-1)?.id;
    }
  }
  if (terminal === undefined) {
    throw new Error(`overlap traversal for ${input.channelId} has no pages`);
  }
  if (new Set(messageIds).size !== messageIds.length) {
    throw new Error(
      `overlap traversal for ${input.channelId} contains duplicate message IDs`,
    );
  }
  return { observations, messageIds, timestamps, terminal };
}

export async function readSeedChannelObservations(input: {
  seedPrefix: string | undefined;
  channelId: string;
}): Promise<CorpusObservation[]> {
  if (input.seedPrefix === undefined) {
    return [];
  }
  const stores = createCorpusStoresFromEnv();
  const manifestKey = `${input.seedPrefix}/manifest.json`;
  const manifestBytes = await readMirroredObject({
    stores,
    key: manifestKey,
  });
  if (manifestBytes === undefined) {
    throw new Error(`seed manifest is missing: ${manifestKey}`);
  }
  const manifest = SeedImportManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(manifestBytes)),
  );
  if (input.seedPrefix !== `seed/${manifest.archiveSha256}`) {
    throw new Error(
      `seed prefix ${input.seedPrefix} does not match archive ${manifest.archiveSha256}`,
    );
  }
  const key = `${input.seedPrefix}/channels/${input.channelId}/observations.ndjson`;
  const bytes = await readMirroredObject({ stores, key });
  const shouldExist = manifest.channelIds.includes(input.channelId);
  if (shouldExist !== (bytes !== undefined)) {
    throw new Error(
      `seed channel partition presence disagrees with ${manifestKey}: ${key}`,
    );
  }
  if (bytes === undefined) {
    return [];
  }
  const observations = parseNdjson(bytes, CorpusObservationSchema);
  if (
    observations.some(
      (observation) =>
        observation.channelId !== input.channelId ||
        observation.source !== "seed",
    )
  ) {
    throw new Error(`seed channel partition has invalid observations: ${key}`);
  }
  return observations;
}

export async function validateSeedForApprovedInventory(input: {
  seedPrefix: string;
  approvedChannelIds: readonly string[];
}): Promise<void> {
  const manifest = await readCorpusJson(
    `${input.seedPrefix}/manifest.json`,
    SeedImportManifestSchema,
  );
  if (input.seedPrefix !== `seed/${manifest.archiveSha256}`) {
    throw new Error(
      `seed prefix ${input.seedPrefix} does not match archive ${manifest.archiveSha256}`,
    );
  }
  const stores = createCorpusStoresFromEnv();
  const archiveBytes = await readVerifiedMirroredObject({
    stores,
    key: `${input.seedPrefix}/archive.zip`,
    expectedSha256: manifest.archiveSha256,
  });
  if (sha256(archiveBytes) !== manifest.archiveSha256) {
    throw new Error(
      `trusted seed archive checksum mismatch: ${input.seedPrefix}`,
    );
  }
  await readVerifiedMirroredObject({
    stores,
    key: `${input.seedPrefix}/projection.ndjson`,
    expectedSha256: manifest.projectionSha256,
  });
  const approved = new Set(input.approvedChannelIds);
  const missing = manifest.channelIds.filter(
    (channelId) => !approved.has(channelId),
  );
  if (missing.length > 0) {
    throw new Error(
      `approved inventory omits ${String(missing.length)} trusted seed channels: ${missing.join(",")}`,
    );
  }
}

export async function loadStateManifest(
  key: string,
): Promise<ChannelStateManifest> {
  return await readCorpusJson(key, ChannelStateManifestSchema);
}

export async function writeChannelProjection(input: {
  guildId: string;
  channelId: string;
  snapshotId: string;
  projectionNdjson: string;
  writtenAt: string;
}): Promise<{ key: string; sha256: string }> {
  const key =
    `guilds/${input.guildId}/channels/${input.channelId}/projections/` +
    `${input.snapshotId}.ndjson`;
  const body = new TextEncoder().encode(input.projectionNdjson);
  await putMirroredImmutableObject({
    stores: createCorpusStoresFromEnv(),
    key,
    body,
    contentType: "application/x-ndjson",
    writtenAt: input.writtenAt,
  });
  return { key, sha256: sha256(body) };
}

export async function writeChannelState(input: {
  guildId: string;
  channelId: string;
  snapshotId: string;
  manifest: ChannelStateManifest;
  writtenAt: string;
  uniqueMessageCount: number;
}) {
  const manifestKey =
    `guilds/${input.guildId}/channels/${input.channelId}/states/` +
    `${input.snapshotId}.json`;
  const manifestObject = await putMirroredImmutableObject({
    stores: createCorpusStoresFromEnv(),
    key: manifestKey,
    body: jsonBytes(input.manifest),
    contentType: "application/json",
    writtenAt: input.writtenAt,
  });
  return ChannelStateResultSchema.parse({
    channelId: input.channelId,
    manifestKey,
    manifestObject,
    uniqueMessageCount: input.uniqueMessageCount,
  });
}
