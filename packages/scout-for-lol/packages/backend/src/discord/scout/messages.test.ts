import { describe, expect, test } from "vitest";
import { ExploreMessageSchema } from "@scout-for-lol/data";
import {
  exploreAnswerChunks,
  publicExploreChunks,
} from "#src/discord/scout/messages.ts";

const answer = ExploreMessageSchema.parse({
  id: "10000000-0000-4000-8000-000000000002",
  role: "assistant",
  parentId: "10000000-0000-4000-8000-000000000001",
  siblingIds: ["10000000-0000-4000-8000-000000000002"],
  content: `@everyone ${"analysis ".repeat(500)}`,
  caveats: ["Only tracked matches are included."],
  createdAt: "2026-08-18T00:00:00.000Z",
});

describe("Scout Discord messages", () => {
  test("bounds private and public prose into Discord-sized chunks", () => {
    const privateChunks = exploreAnswerChunks(answer);
    const publicChunks = publicExploreChunks({
      username: "asker",
      question: "Who wins most often?",
      answer,
    });

    expect(privateChunks.length).toBeGreaterThan(1);
    expect(publicChunks.length).toBeGreaterThan(1);
    for (const chunk of [...privateChunks, ...publicChunks]) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
    expect(publicChunks.join("\n")).toContain("Who wins most often?");
    expect(publicChunks.join("\n")).toContain(
      "Only tracked matches are included.",
    );
  });
});
