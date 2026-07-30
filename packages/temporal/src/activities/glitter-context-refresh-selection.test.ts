import { describe, expect, test } from "bun:test";
import {
  GenerationStateEntrySchema,
  PersonSchema,
} from "@shepherdjerred/glitter-context/schema";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import {
  isSafeStyleSample,
  selectStyleRefreshCandidates,
  shouldRefreshStyleCard,
} from "./glitter-context-refresh-selection.ts";

function message(input: {
  id: string;
  content?: string;
  attachments?: boolean;
  bot?: boolean;
  timestamp?: string;
}) {
  return CurrentMessageSchema.parse({
    schemaVersion: 1,
    source: "discord-rest",
    guildId: "12345678901234567",
    guildSlug: "glitter-boys",
    channelId: "22345678901234567",
    messageId: input.id,
    author: {
      id: "32345678901234567",
      username: "test",
      globalName: "Test",
      discriminator: "0",
      bot: input.bot ?? false,
      avatar: null,
    },
    content: input.content ?? `message ${input.id}`,
    timestamp: input.timestamp ?? "2026-07-01T00:00:00.000Z",
    editedTimestamp: null,
    type: 0,
    flags: "0",
    pinned: false,
    tts: false,
    attachments:
      input.attachments === true
        ? [
            {
              id: "42345678901234567",
              filename: "private.png",
              size: 1,
              url: "https://cdn.example/private.png",
              proxyUrl: "https://proxy.example/private.png",
              contentType: "image/png",
              height: 1,
              width: 1,
              description: null,
              ephemeral: false,
            },
          ]
        : [],
    referencedMessageId: null,
    selectedObservationKey: `observations/${input.id}`,
    selectedObservedAt: "2026-07-01T00:00:01.000Z",
    rawSha256: "a".repeat(64),
  });
}

const person = PersonSchema.parse({
  id: "test-person",
  displayName: "Test Person",
  kind: "person",
  aliases: [],
  discordUserIds: ["32345678901234567"],
});

const state = GenerationStateEntrySchema.parse({
  personId: "test-person",
  lastMessageId: "50000000000000000",
  sourceSnapshotChecksum: "b".repeat(64),
  messageCount: 20,
  refreshedAt: "2026-07-01T00:00:00.000Z",
});

describe("Glitter context refresh selection", () => {
  test("requires 20 new messages before the incremental refresh", () => {
    const messages = Array.from({ length: 40 }, (_, index) =>
      message({ id: String(49_999_999_999_999_981n + BigInt(index)) }),
    );
    const candidates = selectStyleRefreshCandidates({
      people: [person],
      state: [state],
      messages,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.safeMessages).toHaveLength(40);
    expect(candidates[0]?.directRecentMessages).toHaveLength(40);
  });

  test("refreshes quarterly even below the incremental threshold", () => {
    expect(
      shouldRefreshStyleCard({
        newMessageCount: 0,
        refreshedAt: "2026-01-01T00:00:00.000Z",
        now: new Date("2026-04-01T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  test("rejects attachments, mentions, URLs, email addresses, and bots", () => {
    expect(isSafeStyleSample(message({ id: "60000000000000000" }))).toBe(true);
    expect(
      isSafeStyleSample(
        message({ id: "60000000000000001", attachments: true }),
      ),
    ).toBe(false);
    expect(
      isSafeStyleSample(
        message({
          id: "60000000000000002",
          content: "hello <@32345678901234567>",
        }),
      ),
    ).toBe(false);
    expect(
      isSafeStyleSample(
        message({
          id: "60000000000000003",
          content: "see https://example.com/private",
        }),
      ),
    ).toBe(false);
    expect(
      isSafeStyleSample(
        message({
          id: "60000000000000004",
          content: "email me at person@example.com",
        }),
      ),
    ).toBe(false);
    expect(
      isSafeStyleSample(
        message({ id: "60000000000000005", content: "bot text", bot: true }),
      ),
    ).toBe(false);
  });

  test("retains the complete safe corpus and bounds only direct evidence", () => {
    const messages = Array.from({ length: 620 }, (_, index) =>
      message({
        id: String(60_000_000_000_000_000n + BigInt(index)),
        content: `safe message ${String(index)}`,
      }),
    );
    const candidates = selectStyleRefreshCandidates({
      people: [person],
      state: [state],
      messages,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(candidates[0]?.safeMessages).toHaveLength(620);
    expect(candidates[0]?.directRecentMessages).toHaveLength(500);
    expect(candidates[0]?.directRecentMessages[0]?.content).toBe(
      "safe message 120",
    );
  });
});
