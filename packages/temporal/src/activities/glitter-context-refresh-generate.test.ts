import { describe, expect, test } from "bun:test";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  PersonSchema,
  StyleCardSchema,
} from "@shepherdjerred/glitter-context/schema";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import {
  finalizeGeneratedStyleCard,
  GeneratedStyleCardSchema,
} from "./glitter-context-refresh-generate.ts";

const emptyStyleFields = {
  voice: [],
  style_markers: [],
  topics: [],
  relationships: [],
  behaviors: [],
  personality: [],
  humor_or_tone: [],
  quotes: [],
  summary: "",
  likes_dislikes: [],
  other_games: [],
  how_to_mimic: [],
};

const generatedCard = GeneratedStyleCardSchema.parse({
  ...emptyStyleFields,
  league: [],
  sample_messages: ["hello there"],
  concerns: null,
});

const existingCard = StyleCardSchema.parse({
  author: "Ryan",
  coverage: {
    messages: 1,
    date_range: "2025",
    notes: "Existing human-reviewed metadata.",
  },
  ...emptyStyleFields,
  league: {},
  sample_messages: [],
});

const message = CurrentMessageSchema.parse({
  schemaVersion: 1,
  source: "discord-rest",
  guildId: "12345678901234567",
  guildSlug: "glitter-boys",
  channelId: "22345678901234567",
  messageId: "42345678901234567",
  author: {
    id: "32345678901234567",
    username: "nekoryan",
    globalName: "NekoRyan",
    discriminator: "0",
    bot: false,
    avatar: null,
  },
  content: "hello there",
  timestamp: "2026-07-29T00:00:00.000Z",
  editedTimestamp: null,
  type: 0,
  flags: "0",
  pinned: false,
  tts: false,
  attachments: [],
  referencedMessageId: null,
  selectedObservationKey: "observation",
  selectedObservedAt: "2026-07-29T00:00:01.000Z",
  rawSha256: "a".repeat(64),
});

describe("Glitter generated style-card schema", () => {
  test("converts to an OpenAI strict Structured Outputs schema", () => {
    expect(() =>
      zodResponseFormat(GeneratedStyleCardSchema, "style_card"),
    ).not.toThrow();
  });

  test("requires nullable concerns and omits persisted metadata", () => {
    const result = GeneratedStyleCardSchema.safeParse({
      ...emptyStyleFields,
      league: [],
      sample_messages: [],
      concerns: null,
    });

    expect(result.success).toBe(true);
  });

  test("preserves the human-reviewed author when the display name changes", () => {
    const result = finalizeGeneratedStyleCard({
      candidate: {
        person: PersonSchema.parse({
          id: "ryan",
          displayName: "NekoRyan",
          kind: "person",
          aliases: ["Ryan"],
          discordUserIds: ["32345678901234567"],
        }),
        messages: [message],
        safeMessages: [message],
        newMessageCount: 1,
        totalMessageCount: 1,
      },
      existingCard,
      generatedCard,
    });

    expect(result.author).toBe("Ryan");
    expect(result.coverage).toEqual({
      messages: 1,
      date_range: "2026-07-29T00:00:00.000Z through 2026-07-29T00:00:00.000Z",
      notes:
        "Generated from the checksum-verified Discord corpus; human review required.",
    });
  });
});
