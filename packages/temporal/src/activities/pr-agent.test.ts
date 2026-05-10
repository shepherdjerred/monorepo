import { describe, expect, it } from "bun:test";
import { buildClaudeArgs } from "./pr-agent.ts";
import {
  buildReviewPrompt,
  buildSummaryPrompt,
  SUMMARY_MARKER,
} from "./pr-prompts.ts";
import type { PrAgentInput } from "#shared/schemas.ts";

const baseInput: PrAgentInput = {
  kind: "review",
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 1234,
  commitSha: "abc1234567890abc1234567890abc1234567890ab",
  baseRef: "main",
  headRef: "feature/foo",
  prTitle: "Add foo support",
  prAuthor: "alice",
};

describe("buildClaudeArgs", () => {
  it("includes the prompt, MCP config, allowed tools, and permission mode", () => {
    const args = buildClaudeArgs({
      prompt: "do the thing",
      mcpConfigPath: "/tmp/mcp.json",
      kind: "review",
    });
    expect(args[0]).toBe("claude");
    expect(args).toContain("-p");
    expect(args).toContain("do the thing");
    expect(args).toContain("--mcp-config");
    expect(args).toContain("/tmp/mcp.json");
    expect(args).toContain("--allowed-tools");
    expect(args).toContain("mcp__github__*");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });

  it("uses the review model and 30 max turns for kind=review", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      mcpConfigPath: "/tmp/mcp.json",
      kind: "review",
    });
    expect(args).toContain("claude-opus-4-7");
    const maxTurnsIdx = args.indexOf("--max-turns");
    expect(args[maxTurnsIdx + 1]).toBe("30");
  });

  it("uses the summary model and 10 max turns for kind=summary", () => {
    const args = buildClaudeArgs({
      prompt: "x",
      mcpConfigPath: "/tmp/mcp.json",
      kind: "summary",
    });
    expect(args).toContain("claude-haiku-4-5-20251001");
    const maxTurnsIdx = args.indexOf("--max-turns");
    expect(args[maxTurnsIdx + 1]).toBe("10");
  });
});

describe("buildReviewPrompt", () => {
  it("references the PR number, refs, commit, and title", () => {
    const prompt = buildReviewPrompt(baseInput);
    expect(prompt).toContain("shepherdjerred/monorepo#1234");
    expect(prompt).toContain("Add foo support");
    expect(prompt).toContain("main");
    expect(prompt).toContain("feature/foo");
    expect(prompt).toContain("abc1234567890abc1234567890abc1234567890ab");
  });

  it("instructs the agent to read-only and never edit files", () => {
    const prompt = buildReviewPrompt(baseInput);
    expect(prompt).toMatch(/Do not edit any files/i);
    expect(prompt).toMatch(/Do not push commits/i);
  });

  it("does not include the summary marker", () => {
    const prompt = buildReviewPrompt(baseInput);
    expect(prompt).not.toContain(SUMMARY_MARKER);
  });
});

describe("buildSummaryPrompt", () => {
  it("includes the idempotency marker instruction", () => {
    const prompt = buildSummaryPrompt({ ...baseInput, kind: "summary" });
    expect(prompt).toContain(SUMMARY_MARKER);
    expect(prompt).toMatch(/edit it in place/i);
  });

  it("references the PR identifiers", () => {
    const prompt = buildSummaryPrompt({ ...baseInput, kind: "summary" });
    expect(prompt).toContain("shepherdjerred/monorepo#1234");
    expect(prompt).toContain("abc1234567890abc1234567890abc1234567890ab");
  });
});
