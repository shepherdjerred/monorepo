import { createHash } from "node:crypto";
import {
  CorpusObservationSchema,
  CurrentMessageSchema,
  type CorpusObservation,
  type CurrentMessage,
} from "./glitter-corpus.ts";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function compareSnowflakes(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return left.localeCompare(right);
}

function observationVersionTimestamp(observation: CorpusObservation): string {
  return observation.editedTimestamp ?? observation.timestamp;
}

function rawChecksum(observation: CorpusObservation): string {
  return sha256(JSON.stringify(observation.raw));
}

function equivalentImmutableMessageVersion(
  left: CorpusObservation,
  right: CorpusObservation,
): boolean {
  return (
    (left.guildId === right.guildId ||
      left.guildId === null ||
      right.guildId === null) &&
    left.guildSlug === right.guildSlug &&
    left.channelId === right.channelId &&
    left.messageId === right.messageId &&
    JSON.stringify(left.author) === JSON.stringify(right.author) &&
    left.content === right.content &&
    left.timestamp === right.timestamp &&
    left.editedTimestamp === right.editedTimestamp &&
    left.type === right.type &&
    left.flags === right.flags &&
    left.tts === right.tts &&
    JSON.stringify(left.attachments) === JSON.stringify(right.attachments) &&
    left.referencedMessageId === right.referencedMessageId
  );
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

    const versionComparison = observationVersionTimestamp(
      candidate,
    ).localeCompare(observationVersionTimestamp(selected));
    if (versionComparison > 0) {
      selected = candidate;
      continue;
    }
    if (versionComparison < 0) {
      continue;
    }

    if (!equivalentImmutableMessageVersion(candidate, selected)) {
      throw new Error(
        `conflicting payloads for message ${first.messageId} at version ${observationVersionTimestamp(candidate)}`,
      );
    }

    if (
      candidate.observedAt > selected.observedAt ||
      (candidate.observedAt === selected.observedAt &&
        ((candidate.source === "discord-rest" && selected.source === "seed") ||
          (candidate.source === selected.source &&
            candidate.sourceKey.localeCompare(selected.sourceKey) < 0)))
    ) {
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

function currentVersionTimestamp(message: CurrentMessage): string {
  return message.editedTimestamp ?? message.timestamp;
}

function equivalentImmutableCurrentMessage(
  left: CurrentMessage,
  right: CurrentMessage,
): boolean {
  const comparableLeft = {
    ...left,
    pinned: false,
    source: "seed",
    guildId: null,
    selectedObservationKey: "",
    selectedObservedAt: "",
    rawSha256: "",
  };
  const comparableRight = {
    ...right,
    pinned: false,
    source: "seed",
    guildId: null,
    selectedObservationKey: "",
    selectedObservedAt: "",
    rawSha256: "",
  };
  return JSON.stringify(comparableLeft) === JSON.stringify(comparableRight);
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
    const comparison = currentVersionTimestamp(message).localeCompare(
      currentVersionTimestamp(existing),
    );
    if (comparison > 0) {
      byId.set(message.messageId, message);
      continue;
    }
    if (
      comparison === 0 &&
      !equivalentImmutableCurrentMessage(message, existing)
    ) {
      throw new Error(
        `projection has conflicting payloads for message ${message.messageId} at ${currentVersionTimestamp(message)}`,
      );
    }
    if (
      comparison === 0 &&
      (message.selectedObservedAt > existing.selectedObservedAt ||
        (message.selectedObservedAt === existing.selectedObservedAt &&
          message.source === "discord-rest" &&
          existing.source === "seed"))
    ) {
      byId.set(message.messageId, message);
    }
  }

  return [...byId.values()].toSorted((left, right) =>
    compareSnowflakes(left.messageId, right.messageId),
  );
}
