import { describe, expect, test } from "vitest";
import {
  CLASSIFY_SYSTEM,
  TRIAGE_SYSTEM,
  classifyPrompt,
  triagePrompt,
} from "#src/prompts.ts";

describe("storm-brain prompts", () => {
  test("classify names the closed offense vocabulary", () => {
    for (const offense of [
      "spam",
      "advertising",
      "slur",
      "toxicity",
      "grief",
      "theft",
      "cheat",
      "harassment",
    ]) {
      expect(CLASSIFY_SYSTEM).toContain(offense);
    }
    const prompt = classifyPrompt({
      player: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", name: "Alice" },
      lines: [{ text: "buy gold", at: "2017-06-01T12:00:00.000Z" }],
    });
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("buy gold");
  });

  test("triage assembles the whole case", () => {
    expect(TRIAGE_SYSTEM).toContain("urgent");
    const prompt = triagePrompt({
      ticket: {
        id: 7,
        reporter: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        categoryId: "grief",
        statusId: "open",
        priorityId: "normal",
        summary: "my wall is gone",
        location: { world: "world", x: 1, y: 2, z: 3 },
        createdAt: "2017-06-01T12:00:00.000Z",
        updatedAt: "2017-06-01T12:00:00.000Z",
        claimer: null,
        triage: null,
      },
      comments: [
        {
          id: 1,
          author: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
          staffOnly: true,
          body: "checked the logs",
          at: "2017-06-01T12:01:00.000Z",
        },
      ],
      reporterHistory: [
        {
          actionId: "kick",
          actorName: "Console",
          reason: "griefing",
          at: "2017-05-01T12:00:00.000Z",
          expiresAt: null,
        },
      ],
      reporterBanned: false,
      reporterRecentChat: [
        { text: "my wall is gone", at: "2017-06-01T11:59:00.000Z" },
      ],
    });
    expect(prompt).toContain("Ticket #7");
    expect(prompt).toContain("my wall is gone");
    expect(prompt).toContain("world 1,2,3");
    expect(prompt).toContain("checked the logs");
    expect(prompt).toContain("kick by Console");
    expect(prompt).toContain("currently banned: no");
  });
});
