import { describe, expect, it } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  runPrSummary,
  type AnthropicForSummary,
  type OctokitForSummary,
} from "./summary.ts";
import { SUMMARY_MARKER } from "./summary-prompts.ts";
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

type UsageOverrides = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

type FakeAnthropicInput = {
  text: string;
  usage?: UsageOverrides;
  stopReason?: Anthropic.Message["stop_reason"];
};

/**
 * Build a minimal AnthropicForSummary stub that only implements the single
 * path the activity exercises: `messages.stream(...).finalMessage()`. The
 * activity's `anthropic` dependency is typed as the narrow interface, so
 * this fits structurally with no type assertions needed.
 */
function buildFakeAnthropic(input: FakeAnthropicInput): AnthropicForSummary {
  const usage: Anthropic.Usage = {
    input_tokens: input.usage?.inputTokens ?? 200,
    output_tokens: input.usage?.outputTokens ?? 150,
    cache_read_input_tokens: input.usage?.cacheReadInputTokens ?? 0,
    cache_creation_input_tokens: input.usage?.cacheCreationInputTokens ?? 0,
    cache_creation: null,
    inference_geo: null,
    server_tool_use: null,
    service_tier: null,
  };

  const content: Anthropic.ContentBlock[] =
    input.text.length === 0
      ? []
      : [{ type: "text", text: input.text, citations: null }];

  const finalMessage: Anthropic.Message = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: input.stopReason ?? "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage,
    container: null,
  };

  return {
    messages: {
      stream: () => ({
        finalMessage: () => Promise.resolve(finalMessage),
      }),
    },
  };
}

type FakeOctokitInput = {
  diff: string;
  existingComments?: { id: number; body: string | null }[];
  conventionsB64?: string;
};

type CapturedComment = {
  action: "create" | "update";
  body: string;
  commentId?: number;
};

function buildFakeOctokit(input: FakeOctokitInput): {
  octokit: OctokitForSummary;
  captured: CapturedComment[];
} {
  const existing = input.existingComments ?? [];
  const captured: CapturedComment[] = [];

  const octokit: OctokitForSummary = {
    listComments: async () => ({ data: existing }),
    createComment: async (params) => {
      captured.push({ action: "create", body: params.body });
      return { data: { id: 7777, html_url: "https://gh/created/7777" } };
    },
    updateComment: async (params) => {
      captured.push({
        action: "update",
        body: params.body,
        commentId: params.comment_id,
      });
      return {
        data: {
          id: params.comment_id,
          html_url: `https://gh/updated/${String(params.comment_id)}`,
        },
      };
    },
    paginateListComments: () =>
      (async function* () {
        yield { data: existing };
      })(),
    getDiff: async () => ({ data: input.diff }),
    getContent: async () =>
      input.conventionsB64 === undefined
        ? { data: {} }
        : { data: { type: "file", content: input.conventionsB64 } },
  };

  return { octokit, captured };
}

describe("runPrSummary", () => {
  it("creates a new comment on first run", async () => {
    const summaryBody = `${SUMMARY_MARKER}\n\nFix a bug in foo`;
    const anthropic = buildFakeAnthropic({ text: summaryBody });
    const { octokit, captured } = buildFakeOctokit({
      diff: "+ console.log('hi')\n",
    });

    const result = await runPrSummary(basePr, {
      anthropic,
      octokit,
      loadRepoConventionsMarkdown: async () => "Use bun.",
      now: () => 1000,
    });

    expect(result.action).toBe("created");
    expect(result.commentId).toBe(7777);
    expect(captured).toHaveLength(1);
    const first = captured[0];
    if (first === undefined) throw new Error("missing create call");
    expect(first.action).toBe("create");
    expect(first.body).toContain(SUMMARY_MARKER);
    expect(first.body).toContain("Fix a bug in foo");
  });

  it("edits the existing summary comment in place", async () => {
    const summaryBody = `${SUMMARY_MARKER}\n\nUpdated summary`;
    const anthropic = buildFakeAnthropic({ text: summaryBody });
    const { octokit, captured } = buildFakeOctokit({
      diff: "+ foo\n",
      existingComments: [
        { id: 555, body: `${SUMMARY_MARKER}\n\nOlder summary` },
      ],
    });

    const result = await runPrSummary(basePr, {
      anthropic,
      octokit,
      loadRepoConventionsMarkdown: async () => "",
      now: () => 1000,
    });

    expect(result.action).toBe("updated");
    expect(result.commentId).toBe(555);
    expect(captured).toHaveLength(1);
    const first = captured[0];
    if (first === undefined) throw new Error("missing update call");
    expect(first.action).toBe("update");
    expect(first.commentId).toBe(555);
  });

  it("rejects a summary body that omits the marker (off-prompt model)", async () => {
    const anthropic = buildFakeAnthropic({
      text: "Hi I'm a summary but I forgot the marker.",
    });
    const { octokit } = buildFakeOctokit({ diff: "+ x\n" });

    await expect(
      runPrSummary(basePr, {
        anthropic,
        octokit,
        loadRepoConventionsMarkdown: async () => "",
        now: () => 1000,
      }),
    ).rejects.toThrow(/marker/i);
  });

  it("throws when the model returns no text content", async () => {
    const anthropic = buildFakeAnthropic({
      text: "",
      stopReason: "max_tokens",
    });
    const { octokit } = buildFakeOctokit({ diff: "" });

    await expect(
      runPrSummary(basePr, {
        anthropic,
        octokit,
        loadRepoConventionsMarkdown: async () => "",
        now: () => 1000,
      }),
    ).rejects.toThrow(/no text content/i);
  });

  it("truncates large diffs to keep prompts bounded", async () => {
    // 1MB of plus lines — well past MAX_DIFF_BYTES.
    const hugeDiff = "+ x\n".repeat(300_000);
    const anthropic = buildFakeAnthropic({
      text: `${SUMMARY_MARKER}\n\nHuge PR`,
    });
    const { octokit } = buildFakeOctokit({ diff: hugeDiff });

    const result = await runPrSummary(basePr, {
      anthropic,
      octokit,
      loadRepoConventionsMarkdown: async () => "",
      now: () => 1000,
    });

    expect(result.diffTruncated).toBe(true);
    expect(result.diffBytes).toBe(Buffer.byteLength(hugeDiff, "utf8"));
  });

  it("reports cost under $0.10 for typical input sizes (Phase 7 budget)", async () => {
    // Typical PR summary: ~5k input (diff + repo conventions), ~500 output.
    // Haiku: $1/M input + $5/M output = $0.005 + $0.0025 = $0.0075. Plus a
    // small cache-read tail. Should be well under the $0.10/summary ceiling
    // the task description sets.
    const anthropic = buildFakeAnthropic({
      text: `${SUMMARY_MARKER}\n\nbody`,
      usage: {
        inputTokens: 5000,
        outputTokens: 500,
        cacheReadInputTokens: 2000,
      },
    });
    const { octokit } = buildFakeOctokit({ diff: "+ x\n" });

    const result = await runPrSummary(basePr, {
      anthropic,
      octokit,
      loadRepoConventionsMarkdown: async () => "",
      now: () => 1000,
    });

    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.costUsd).toBeLessThan(0.1);
  });

  it("propagates token usage to the result for metrics consumers", async () => {
    const anthropic = buildFakeAnthropic({
      text: `${SUMMARY_MARKER}\n\nbody`,
      usage: {
        inputTokens: 1234,
        outputTokens: 567,
        cacheReadInputTokens: 89,
        cacheCreationInputTokens: 12,
      },
    });
    const { octokit } = buildFakeOctokit({ diff: "+ x\n" });

    const result = await runPrSummary(basePr, {
      anthropic,
      octokit,
      loadRepoConventionsMarkdown: async () => "",
      now: () => 1000,
    });

    expect(result.inputTokens).toBe(1234);
    expect(result.outputTokens).toBe(567);
    expect(result.cacheReadInputTokens).toBe(89);
    expect(result.cacheCreationInputTokens).toBe(12);
  });

  it("computes wall-clock duration from the injected clock", async () => {
    const anthropic = buildFakeAnthropic({
      text: `${SUMMARY_MARKER}\n\nbody`,
    });
    const { octokit } = buildFakeOctokit({ diff: "+ x\n" });

    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 1000 : 7500;
    };

    const result = await runPrSummary(basePr, {
      anthropic,
      octokit,
      loadRepoConventionsMarkdown: async () => "",
      now,
    });
    expect(result.durationMs).toBe(6500);
  });

  it("throws when the GitHub diff endpoint returns a non-string body", async () => {
    const anthropic = buildFakeAnthropic({
      text: `${SUMMARY_MARKER}\n\nbody`,
    });
    const octokit: OctokitForSummary = {
      listComments: async () => ({ data: [] }),
      createComment: async () => ({ data: { id: 1, html_url: "" } }),
      updateComment: async () => ({ data: { id: 1, html_url: "" } }),
      paginateListComments: () =>
        (async function* () {
          yield { data: [] };
        })(),
      // Return an object instead of a string — should trigger the runtime guard.
      getDiff: async () => ({ data: { not: "a string" } }),
      getContent: async () => ({ data: {} }),
    };

    await expect(
      runPrSummary(basePr, {
        anthropic,
        octokit,
        loadRepoConventionsMarkdown: async () => "",
        now: () => 1000,
      }),
    ).rejects.toThrow(/Expected diff string/);
  });
});
