import { describe, expect, test } from "bun:test";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import {
  buildStyleEvidenceChunks,
  STYLE_EVIDENCE_CHUNK_SIZE,
} from "./glitter-context-refresh-chunks.ts";

function message(input: { id: bigint; timestamp: string }) {
  return CurrentMessageSchema.parse({
    schemaVersion: 1,
    source: "discord-rest",
    guildId: "12345678901234567",
    guildSlug: "glitter-boys",
    channelId: "22345678901234567",
    messageId: String(input.id),
    author: {
      id: "32345678901234567",
      username: "test",
      globalName: "Test",
      discriminator: "0",
      bot: false,
      avatar: null,
    },
    content: `message ${String(input.id)}`,
    timestamp: input.timestamp,
    editedTimestamp: null,
    type: 0,
    flags: "0",
    pinned: false,
    tts: false,
    attachments: [],
    referencedMessageId: null,
    selectedObservationKey: `observations/${String(input.id)}`,
    selectedObservedAt: "2026-07-01T00:00:01.000Z",
    rawSha256: "a".repeat(64),
  });
}

describe("Glitter style evidence chunks", () => {
  test("covers every message once in deterministic UTC-month chunks", () => {
    const january = Array.from({ length: 251 }, (_, index) =>
      message({
        id: 60_000_000_000_000_000n + BigInt(index),
        timestamp: "2026-01-31T23:00:00.000-08:00",
      }),
    );
    const march = Array.from({ length: 260 }, (_, index) =>
      message({
        id: 61_000_000_000_000_000n + BigInt(index),
        timestamp: "2026-03-15T00:00:00.000Z",
      }),
    );
    const input = [...march.toReversed(), ...january.toReversed()];
    const chunks = buildStyleEvidenceChunks(input);

    expect(chunks.map((chunk) => chunk.key)).toEqual([
      "2026-02-0000",
      "2026-02-0001",
      "2026-03-0000",
      "2026-03-0001",
    ]);
    expect(chunks.map((chunk) => chunk.messages.length)).toEqual([
      250, 1, 250, 10,
    ]);
    expect(
      chunks.every(
        (chunk) => chunk.messages.length <= STYLE_EVIDENCE_CHUNK_SIZE,
      ),
    ).toBe(true);
    expect(
      chunks.flatMap((chunk) => chunk.messages.map((entry) => entry.messageId)),
    ).toHaveLength(input.length);
  });
});
