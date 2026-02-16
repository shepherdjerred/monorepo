import { describe, test, expect } from "bun:test";
import {
  truncateDiscordMessage,
  truncateEmbedFieldValue,
  truncateEmbedDescription,
  splitMessageIntoChunks,
} from "@scout-for-lol/backend/discord/utils/message.ts";

describe("truncateDiscordMessage", () => {
  test("does not truncate short messages", () => {
    const message = "Short message";
    expect(truncateDiscordMessage(message)).toBe(message);
  });

  test("truncates messages exceeding default max length", () => {
    const message = "a".repeat(2000);
    const result = truncateDiscordMessage(message);
    expect(result.length).toBe(1903); // 1900 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  test("respects custom max length", () => {
    const message = "a".repeat(200);
    const result = truncateDiscordMessage(message, 100);
    expect(result.length).toBe(103); // 100 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  test("handles exact max length", () => {
    const message = "a".repeat(1900);
    const result = truncateDiscordMessage(message);
    expect(result).toBe(message);
  });
});

describe("truncateEmbedFieldValue", () => {
  test("does not truncate short text", () => {
    const text = "Short field value";
    expect(truncateEmbedFieldValue(text)).toBe(text);
  });

  test("truncates text exceeding 1024 character limit", () => {
    const text = "a".repeat(1100);
    const result = truncateEmbedFieldValue(text);
    expect(result.length).toBe(1007); // 1004 + "..."
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("truncateEmbedDescription", () => {
  test("does not truncate short text", () => {
    const text = "Short description";
    expect(truncateEmbedDescription(text)).toBe(text);
  });

  test("truncates text exceeding 4096 character limit", () => {
    const text = "a".repeat(5000);
    const result = truncateEmbedDescription(text);
    expect(result.length).toBe(4079); // 4076 + "..."
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("splitMessageIntoChunks", () => {
  test("returns single chunk for short messages", () => {
    const message = "Short message";
    const chunks = splitMessageIntoChunks(message);
    expect(chunks).toEqual([message]);
  });

  test("returns single chunk for messages at max length", () => {
    const message = "a".repeat(1900);
    const chunks = splitMessageIntoChunks(message);
    expect(chunks).toEqual([message]);
  });

  test("splits long message without sections into multiple chunks", () => {
    const message = "a".repeat(4000);
    const chunks = splitMessageIntoChunks(message);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be within limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
  });

  test("splits at section boundaries when possible", () => {
    const section1 = "## Section 1\nContent for section 1";
    const section2 = "## Section 2\nContent for section 2";
    const message = `${section1}\n${section2}`;

    // With a very small limit, it should split at section boundaries
    const chunks = splitMessageIntoChunks(message, 50);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("Section 1");
    expect(chunks[1]).toContain("Section 2");
  });

  test("handles message with multiple sections", () => {
    const message = `# Header

## Section 1
Line 1
Line 2
Line 3

## Section 2
More content here
And more lines

## Section 3
Final content`;

    const chunks = splitMessageIntoChunks(message, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should be within limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  test("handles single very long line by splitting", () => {
    const message = "a".repeat(2500);
    const chunks = splitMessageIntoChunks(message, 100);
    // Should split into approximately 25 chunks (2500 / 100)
    // Using range to avoid brittle exact assertion
    expect(chunks.length).toBeGreaterThanOrEqual(25);
    expect(chunks.length).toBeLessThanOrEqual(26);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  test("preserves section headers with content", () => {
    const message = `## Ranked
1. Player A - 75%
2. Player B - 70%

## Arena
1. Player C - 80%`;

    const chunks = splitMessageIntoChunks(message, 60);
    // Check that section headers are preserved with their content
    const hasRankedHeader = chunks.some((c) => c.includes("## Ranked"));
    const hasArenaHeader = chunks.some((c) => c.includes("## Arena"));
    expect(hasRankedHeader).toBe(true);
    expect(hasArenaHeader).toBe(true);
  });

  test("handles empty message", () => {
    const chunks = splitMessageIntoChunks("");
    expect(chunks).toEqual([]);
  });

  test("trims whitespace from chunks", () => {
    const message = `## Section 1
Content

## Section 2
More content`;

    const chunks = splitMessageIntoChunks(message, 40);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
    }
  });

  test("handles message starting with ## header", () => {
    const message = `## First Section
Content for first section

## Second Section
Content for second section`;

    const chunks = splitMessageIntoChunks(message, 60);
    // First section should be captured correctly
    expect(chunks[0]).toContain("## First Section");
    expect(chunks[0]).toContain("Content for first");
    // Second section should also be present
    const hasSecondSection = chunks.some((c) => c.includes("## Second Section"));
    expect(hasSecondSection).toBe(true);
  });

  test("keeps section headers with their immediate content", () => {
    const message = `## Section A
Line 1
Line 2

## Section B
Line 3`;

    const chunks = splitMessageIntoChunks(message, 40);
    // If "## Section A" appears in a chunk, "Line 1" should be in the same chunk
    const sectionAChunk = chunks.find((c) => c.includes("## Section A"));
    expect(sectionAChunk).toBeDefined();
    expect(sectionAChunk).toContain("Line 1");
  });
});
