import { describe, expect, it } from "bun:test";
import {
  buildSummarySystemBlocks,
  buildSummaryUserPrompt,
  SUMMARY_MARKER,
} from "./summary-prompts.ts";
import type { PrSummaryInput } from "#shared/schemas.ts";

const basePr: PrSummaryInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 1234,
  commitSha: "abc1234567890abc1234567890abc1234567890ab",
  baseRef: "main",
  headRef: "feature/foo",
  prTitle: "Add foo support",
  prAuthor: "alice",
};

describe("SUMMARY_MARKER", () => {
  it("is distinct from the legacy marker so both summaries can coexist during shadow mode", () => {
    // The webhook starts the new SDK summary pipeline alongside the legacy
    // `claude -p` summary during shadow mode. Each path edits in place via
    // its own marker so reviewers (and the eval grader) get to compare
    // both summaries side-by-side on every non-draft PR. If the markers
    // collided, the two upserts would race and we'd lose one of the
    // summaries.
    expect(SUMMARY_MARKER).toBe("<!-- pr-summary-sdk -->");
    expect(SUMMARY_MARKER).not.toBe("<!-- pr-summary -->");
  });
});

describe("buildSummaryUserPrompt", () => {
  it("includes every PR identifier", () => {
    const prompt = buildSummaryUserPrompt({
      pr: basePr,
      diff: "+ console.log('hi')",
    });
    expect(prompt).toContain("shepherdjerred/monorepo");
    expect(prompt).toContain("#1234");
    expect(prompt).toContain("Add foo support");
    expect(prompt).toContain("@alice");
    expect(prompt).toContain("main");
    expect(prompt).toContain("feature/foo");
    expect(prompt).toContain("abc1234567890abc1234567890abc1234567890ab");
  });

  it("embeds the diff in a fenced ```diff block", () => {
    const prompt = buildSummaryUserPrompt({
      pr: basePr,
      diff: "+ added line\n- removed line",
    });
    expect(prompt).toMatch(/```diff\n[\s\S]*added line[\s\S]*```/);
  });

  it("instructs the model to start the body with the marker line", () => {
    const prompt = buildSummaryUserPrompt({ pr: basePr, diff: "" });
    expect(prompt).toContain(SUMMARY_MARKER);
    expect(prompt).toMatch(/starting with the/);
  });
});

describe("buildSummarySystemBlocks", () => {
  it("returns exactly two blocks: preamble and conventions", () => {
    const blocks = buildSummarySystemBlocks({
      repoConventionsMarkdown: "Use bun. Never npm.",
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe("text");
    expect(blocks[1]?.type).toBe("text");
  });

  it("places cache_control on the last block to cache the entire prefix", () => {
    // Render order is tools -> system -> messages. Pinning cache_control on
    // the last system block tells the API to cache everything from start up
    // to (and including) that block. Earlier breakpoints would only cache a
    // shorter prefix and leave the conventions block uncached.
    const blocks = buildSummarySystemBlocks({
      repoConventionsMarkdown: "x",
    });
    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("includes the conventions markdown verbatim in the second block", () => {
    const conventions = "# Repo conventions\n- use bun";
    const blocks = buildSummarySystemBlocks({
      repoConventionsMarkdown: conventions,
    });
    const second = blocks[1];
    if (second?.type !== "text") throw new Error("expected text block");
    expect(second.text).toContain(conventions);
  });

  it("instructs the model to omit the Risk section when nothing notable", () => {
    const blocks = buildSummarySystemBlocks({ repoConventionsMarkdown: "" });
    const first = blocks[0];
    if (first?.type !== "text") throw new Error("expected text block");
    expect(first.text).toMatch(/Omit the entire "Risk" section/i);
  });

  it("enforces the ~250 word cap and bans emojis / code-fence wrappers", () => {
    const blocks = buildSummarySystemBlocks({ repoConventionsMarkdown: "" });
    const first = blocks[0];
    if (first?.type !== "text") throw new Error("expected text block");
    expect(first.text).toMatch(/under ~250 words/i);
    expect(first.text).toMatch(/No emojis/);
    expect(first.text).toMatch(/Do not wrap in code fences/i);
  });
});
