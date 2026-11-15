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

  test("renders coach options as a compact numbered list between prose and caveats", () => {
    const withOptions = ExploreMessageSchema.parse({
      ...answer,
      content: "Your team lacks a frontline.",
      coachOptions: [
        { label: "Ornn", rationale: "Adds the frontline you lack." },
        { label: "Ahri *mid*", rationale: "Safe if you prefer mobility." },
      ],
    });

    const [chunk] = exploreAnswerChunks(withOptions);

    expect(chunk).toBe(
      [
        "Your team lacks a frontline.",
        "",
        "**Options**",
        "1. **Ornn** - Adds the frontline you lack.",
        String.raw`2. **Ahri \*mid\*** - Safe if you prefer mobility.`,
        "",
        "**Caveats**",
        "- Only tracked matches are included.",
      ].join("\n"),
    );
  });

  test("an answer without options reads exactly as before", () => {
    expect(exploreAnswerChunks({ ...answer, content: "Short." })[0]).toBe(
      "Short.\n\n**Caveats**\n- Only tracked matches are included.",
    );
  });
});
