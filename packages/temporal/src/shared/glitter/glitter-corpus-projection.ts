import { createHash } from "node:crypto";
import {
  CorpusObservationSchema,
  CurrentMessageSchema,
  type CorpusObservation,
  type CurrentMessage,
  type DiscordAttachment,
} from "./glitter-corpus.ts";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function compareSnowflakes(left: string, right: string): number {
  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

function instantMilliseconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`invalid ISO timestamp: ${value}`);
  }
  return milliseconds;
}

function observationVersionTimestamp(observation: CorpusObservation): number {
  return instantMilliseconds(
    observation.editedTimestamp ?? observation.timestamp,
  );
}

function rawChecksum(observation: CorpusObservation): string {
  return sha256(JSON.stringify(observation.raw));
}

function stableAttachments(attachments: readonly DiscordAttachment[]): {
  id: string;
  filename: string;
  size: number;
  contentType: string | null;
  height: number | null;
  width: number | null;
  description: string | null;
  ephemeral: boolean;
}[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    size: attachment.size,
    contentType: attachment.contentType,
    height: attachment.height,
    width: attachment.width,
    description: attachment.description,
    ephemeral: attachment.ephemeral,
  }));
}

type ImmutableMessageVersion = {
  source: CorpusObservation["source"];
  guildId: string | null;
  guildSlug: string;
  channelId: string;
  messageId: string;
  author: {
    id: string;
    bot: boolean;
  };
  content: string;
  timestamp: string;
  editedTimestamp: string | null;
  type: number;
  flags: string;
  tts: boolean;
  attachments: readonly DiscordAttachment[];
  referencedMessageId: string | null;
};

function hasSeedAndDiscordSources(
  left: ImmutableMessageVersion,
  right: ImmutableMessageVersion,
): boolean {
  return (
    (left.source === "seed" && right.source === "discord-rest") ||
    (left.source === "discord-rest" && right.source === "seed")
  );
}

/**
 * Discord message flags that record later events on an existing message, so
 * they change without Discord updating `edited_timestamp`
 * (https://docs.discord.com/developers/resources/message#message-object-message-flags):
 *
 * - CROSSPOSTED (1 << 0): the message was published to following channels.
 * - SUPPRESS_EMBEDS (1 << 2): set and unset after sending by anyone who hides
 *   or restores the embeds.
 * - SOURCE_MESSAGE_DELETED (1 << 3): the source of this crosspost was deleted.
 * - HAS_THREAD (1 << 5): a thread was started from the message.
 *
 * The remaining flags describe how the message was created, so a difference
 * in any other bit at the same version is still a conflict.
 */
const EDIT_FREE_MESSAGE_FLAGS =
  (1n << 0n) | (1n << 2n) | (1n << 3n) | (1n << 5n);

function creationMessageFlags(flags: string): bigint {
  if (!/^\d+$/u.test(flags)) {
    throw new TypeError(`invalid Discord message flags: ${flags}`);
  }
  return BigInt(flags) & ~EDIT_FREE_MESSAGE_FLAGS;
}

function sameInstant(left: string | null, right: string | null): boolean {
  return left === null || right === null
    ? left === right
    : instantMilliseconds(left) === instantMilliseconds(right);
}

/**
 * Names the identity and edit-versioned fields that differ between two
 * observations of the same message version. Discord changes `pinned`, the
 * author profile, signed attachment URLs and the edit-free flag bits without
 * an edit, so those resolve by observation preference instead of appearing
 * here. Only field names are returned, never values.
 */
function versionFieldDifferences(
  left: ImmutableMessageVersion,
  right: ImmutableMessageVersion,
): string[] {
  const checks: [string, boolean][] = [
    [
      "guildId",
      left.guildId === right.guildId ||
        left.guildId === null ||
        right.guildId === null,
    ],
    ["guildSlug", left.guildSlug === right.guildSlug],
    ["channelId", left.channelId === right.channelId],
    ["messageId", left.messageId === right.messageId],
    ["author.id", left.author.id === right.author.id],
    ["author.bot", left.author.bot === right.author.bot],
    ["content", left.content === right.content],
    ["timestamp", sameInstant(left.timestamp, right.timestamp)],
    [
      "editedTimestamp",
      sameInstant(left.editedTimestamp, right.editedTimestamp),
    ],
    ["type", left.type === right.type],
    [
      "flags",
      creationMessageFlags(left.flags) === creationMessageFlags(right.flags),
    ],
    ["tts", left.tts === right.tts],
    [
      "attachments",
      JSON.stringify(stableAttachments(left.attachments)) ===
        JSON.stringify(stableAttachments(right.attachments)),
    ],
    [
      "referencedMessageId",
      left.referencedMessageId === right.referencedMessageId,
    ],
  ];
  return checks.filter(([, equal]) => !equal).map(([field]) => field);
}

type SameVersionResolution = "equivalent" | "seed-content-drift";

/**
 * Classifies two observations of the same message version. Content drift
 * between a trusted seed row and Discord is the only tolerated content
 * difference; every other identity or edit-versioned difference throws.
 */
function resolveSameVersion(
  left: ImmutableMessageVersion,
  right: ImmutableMessageVersion,
  conflictMessage: string,
): SameVersionResolution {
  const differences = versionFieldDifferences(left, right);
  if (differences.length === 0) {
    return "equivalent";
  }
  if (
    differences.length === 1 &&
    differences[0] === "content" &&
    hasSeedAndDiscordSources(left, right)
  ) {
    return "seed-content-drift";
  }
  throw new Error(
    `${conflictMessage} (differing fields: ${differences.join(", ")})`,
  );
}

function observationPreference(
  candidate: CorpusObservation,
  selected: CorpusObservation,
): number {
  const observedAtComparison =
    instantMilliseconds(candidate.observedAt) -
    instantMilliseconds(selected.observedAt);
  if (observedAtComparison !== 0) {
    return observedAtComparison;
  }
  if (candidate.source !== selected.source) {
    return candidate.source === "discord-rest" ? 1 : -1;
  }
  const sourceKeyComparison = selected.sourceKey.localeCompare(
    candidate.sourceKey,
  );
  return sourceKeyComparison === 0
    ? selectedRawChecksum(selected).localeCompare(
        selectedRawChecksum(candidate),
      )
    : sourceKeyComparison;
}

function selectedRawChecksum(observation: CorpusObservation): string {
  return rawChecksum(observation);
}

export function selectCurrentObservation(
  observations: readonly CorpusObservation[],
): CorpusObservation {
  if (observations.length === 0) {
    throw new Error("cannot select a current message from zero observations");
  }

  const parsed = observations.map((observation) =>
    CorpusObservationSchema.parse(observation),
  );
  const first = parsed[0];
  if (first === undefined) {
    throw new Error("parsed observation set unexpectedly became empty");
  }

  let selected = first;
  for (const candidate of parsed.slice(1)) {
    if (
      candidate.messageId !== first.messageId ||
      candidate.channelId !== first.channelId ||
      candidate.guildSlug !== first.guildSlug
    ) {
      throw new Error(
        `observation identity conflict for message ${first.messageId}`,
      );
    }

    const versionComparison =
      observationVersionTimestamp(candidate) -
      observationVersionTimestamp(selected);
    if (versionComparison > 0) {
      selected = candidate;
      continue;
    }
    if (versionComparison < 0) {
      continue;
    }

    const resolution = resolveSameVersion(
      candidate,
      selected,
      `conflicting payloads for message ${first.messageId} at version ${candidate.editedTimestamp ?? candidate.timestamp}`,
    );
    if (resolution === "seed-content-drift") {
      if (candidate.source === "discord-rest") {
        selected = candidate;
      }
      continue;
    }

    if (observationPreference(candidate, selected) > 0) {
      selected = candidate;
    }
  }

  return selected;
}

export function toCurrentMessage(
  observation: CorpusObservation,
): CurrentMessage {
  return CurrentMessageSchema.parse({
    schemaVersion: observation.schemaVersion,
    source: observation.source,
    selectedObservationKey: observation.sourceKey,
    selectedObservedAt: observation.observedAt,
    guildId: observation.guildId,
    guildSlug: observation.guildSlug,
    channelId: observation.channelId,
    messageId: observation.messageId,
    author: observation.author,
    content: observation.content,
    timestamp: observation.timestamp,
    editedTimestamp: observation.editedTimestamp,
    type: observation.type,
    flags: observation.flags,
    pinned: observation.pinned,
    tts: observation.tts,
    attachments: observation.attachments,
    referencedMessageId: observation.referencedMessageId,
    rawSha256: rawChecksum(observation),
  });
}

export function buildCurrentProjection(
  observations: readonly CorpusObservation[],
): CurrentMessage[] {
  const grouped = new Map<string, CorpusObservation[]>();
  for (const input of observations) {
    const observation = CorpusObservationSchema.parse(input);
    const existing = grouped.get(observation.messageId);
    if (existing === undefined) {
      grouped.set(observation.messageId, [observation]);
    } else {
      existing.push(observation);
    }
  }

  return [...grouped.values()]
    .map((group) => toCurrentMessage(selectCurrentObservation(group)))
    .toSorted((left, right) =>
      compareSnowflakes(left.messageId, right.messageId),
    );
}

export function serializeProjection(
  projection: readonly CurrentMessage[],
): string {
  const parsed = projection
    .map((message) => CurrentMessageSchema.parse(message))
    .toSorted((left, right) =>
      compareSnowflakes(left.messageId, right.messageId),
    );
  return `${parsed.map((message) => JSON.stringify(message)).join("\n")}\n`;
}

export function projectionChecksum(
  projection: readonly CurrentMessage[],
): string {
  return sha256(serializeProjection(projection));
}

function currentVersionTimestamp(message: CurrentMessage): number {
  return instantMilliseconds(message.editedTimestamp ?? message.timestamp);
}

function currentMessagePreference(
  candidate: CurrentMessage,
  selected: CurrentMessage,
): number {
  const observedAtComparison =
    instantMilliseconds(candidate.selectedObservedAt) -
    instantMilliseconds(selected.selectedObservedAt);
  if (observedAtComparison !== 0) {
    return observedAtComparison;
  }
  if (candidate.source !== selected.source) {
    return candidate.source === "discord-rest" ? 1 : -1;
  }
  const sourceKeyComparison = selected.selectedObservationKey.localeCompare(
    candidate.selectedObservationKey,
  );
  return sourceKeyComparison === 0
    ? selected.rawSha256.localeCompare(candidate.rawSha256)
    : sourceKeyComparison;
}

export function mergeCurrentProjection(
  existingInput: readonly CurrentMessage[],
  observations: readonly CorpusObservation[],
): CurrentMessage[] {
  const byId = new Map<string, CurrentMessage>();
  for (const input of existingInput) {
    const message = CurrentMessageSchema.parse(input);
    if (byId.has(message.messageId)) {
      throw new Error(
        `existing projection contains duplicate message ${message.messageId}`,
      );
    }
    byId.set(message.messageId, message);
  }

  const incoming = buildCurrentProjection(observations);
  for (const message of incoming) {
    const existing = byId.get(message.messageId);
    if (existing === undefined) {
      byId.set(message.messageId, message);
      continue;
    }
    if (
      existing.channelId !== message.channelId ||
      existing.guildSlug !== message.guildSlug
    ) {
      throw new Error(
        `projection identity conflict for message ${message.messageId}`,
      );
    }
    const comparison =
      currentVersionTimestamp(message) - currentVersionTimestamp(existing);
    if (comparison > 0) {
      byId.set(message.messageId, message);
      continue;
    }
    if (comparison < 0) {
      continue;
    }
    const resolution = resolveSameVersion(
      message,
      existing,
      `projection has conflicting payloads for message ${message.messageId} at ${message.editedTimestamp ?? message.timestamp}`,
    );
    if (resolution === "seed-content-drift") {
      if (message.source === "discord-rest") {
        byId.set(message.messageId, message);
      }
      continue;
    }
    if (currentMessagePreference(message, existing) > 0) {
      byId.set(message.messageId, message);
    }
  }

  return [...byId.values()].toSorted((left, right) =>
    compareSnowflakes(left.messageId, right.messageId),
  );
}
