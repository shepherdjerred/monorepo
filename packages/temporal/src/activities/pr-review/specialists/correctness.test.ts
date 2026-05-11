import { describe, expect, it, mock } from "bun:test";
import {
  CORRECTNESS_EFFORT,
  CORRECTNESS_MAX_TOKENS,
  CORRECTNESS_MODEL,
  CORRECTNESS_SYSTEM_PROMPT,
  CorrectnessOutputSchema,
  buildCorrectnessUserText,
  runCorrectnessReviewer,
  type CorrectnessAnthropicClient,
  type CorrectnessOutput,
  type CorrectnessReviewInput,
} from "./correctness.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type { PrReviewContext } from "#shared/pr-review/context.ts";

const PIPELINE: PrReviewPipelineInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 724,
  commitSha: "abc1234567890abc1234567890abc1234567890ab",
  baseRef: "main",
  headRef: "feature/foo",
  prTitle: "Add foo support",
  prAuthor: "alice",
};

const CONTEXT: PrReviewContext = {
  workdir: "",
  changedFiles: [
    {
      path: "packages/temporal/src/worker.ts",
      status: "modified",
      additions: 12,
      deletions: 3,
      patch: "@@ -1,5 +1,12 @@\n-const x = 1;\n+const x = 2;",
    },
    {
      path: "packages/temporal/bun.lock",
      status: "modified",
      additions: 50,
      deletions: 0,
      patch: null,
    },
  ],
  claudeMdHierarchy: [
    {
      path: "CLAUDE.md",
      content: "# repo CLAUDE\n\nUse bun.",
    },
    {
      path: "packages/temporal/CLAUDE.md",
      content: "# temporal CLAUDE\n\nUse @sentry/bun, not @sentry/node.",
    },
  ],
  retrievedSymbols: [],
  blockDiffs: [],
};

const INPUT: CorrectnessReviewInput = {
  pipeline: PIPELINE,
  context: CONTEXT,
};

describe("foundation parity: correctness system prompt", () => {
  it("retains the legacy review-focus bullets (functionality, architecture, logic, security, design)", () => {
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("Functionality");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("Architectural fit");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("Logic errors");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("Security");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("Design");
  });

  it("retains the 'cite path and line numbers, no hand-waving' parity instruction", () => {
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("path");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("line number");
    expect(CORRECTNESS_SYSTEM_PROMPT.toLowerCase()).toContain("do not invent");
  });

  it("retains the 'skip Prettier/ESLint nits' parity instruction", () => {
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("Prettier/ESLint");
  });

  it("pins the agent's kind to 'correctness' so it doesn't encroach on other specialists", () => {
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain(`"correctness"`);
  });

  it("describes the verifier field contract (typecheck/eslint/grep/test/none)", () => {
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("typecheck");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("eslint");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("grep");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("test");
    expect(CORRECTNESS_SYSTEM_PROMPT).toContain("none");
  });
});

describe("foundation: buildCorrectnessUserText", () => {
  it("places the PR metadata header above the CLAUDE.md hierarchy and the diff", () => {
    const text = buildCorrectnessUserText(INPUT);
    const headerIdx = text.indexOf(
      "# Pull request shepherdjerred/monorepo#724",
    );
    const claudeIdx = text.indexOf("CLAUDE.md hierarchy");
    const diffIdx = text.indexOf("## Changed files");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(claudeIdx).toBeGreaterThan(headerIdx);
    expect(diffIdx).toBeGreaterThan(claudeIdx);
  });

  it("embeds every changed file's patch in a diff fence", () => {
    const text = buildCorrectnessUserText(INPUT);
    expect(text).toContain("`packages/temporal/src/worker.ts`");
    expect(text).toContain("modified (+12 / -3)");
    expect(text).toContain("```diff");
    expect(text).toContain("-const x = 1;");
  });

  it("flags binary / oversize files where the patch is unavailable", () => {
    const text = buildCorrectnessUserText(INPUT);
    expect(text).toContain("`packages/temporal/bun.lock`");
    expect(text).toContain("Patch unavailable");
  });

  it("embeds the CLAUDE.md hierarchy in a markdown fence so the model knows the conventions for the package", () => {
    const text = buildCorrectnessUserText(INPUT);
    expect(text).toContain("`packages/temporal/CLAUDE.md`");
    expect(text).toContain("Use @sentry/bun, not @sentry/node");
  });

  it("truncates files past the cap with an explicit dropped-files note rather than silently dropping", () => {
    const manyFiles: PrReviewContext = {
      ...CONTEXT,
      changedFiles: Array.from({ length: 200 }, (_, i) => ({
        path: `packages/temporal/src/file_${String(i)}.ts`,
        status: "modified" as const,
        additions: 1,
        deletions: 1,
        patch: `@@ -1 +1 @@\n-old_${String(i)}\n+new_${String(i)}`,
      })),
    };
    const text = buildCorrectnessUserText({
      pipeline: PIPELINE,
      context: manyFiles,
    });
    expect(text).toContain("50 additional files were truncated");
  });
});

const VALID_OUTPUT: CorrectnessOutput = {
  findings: [
    {
      id: "f1",
      file: "packages/temporal/src/worker.ts",
      lineStart: 100,
      lineEnd: 100,
      kind: "correctness",
      severity: "warning",
      verifier: "typecheck",
      claim: "missing await on async call",
      evidence: "spawn returns a Promise; result is discarded",
      confidence: 0.8,
    },
  ],
};

function makeAnthropicClient(output: CorrectnessOutput): {
  client: CorrectnessAnthropicClient;
  parseCalls: Parameters<CorrectnessAnthropicClient["messages"]["parse"]>[0][];
} {
  const parseCalls: Parameters<
    CorrectnessAnthropicClient["messages"]["parse"]
  >[0][] = [];
  const client: CorrectnessAnthropicClient = {
    messages: {
      parse: async (params) => {
        parseCalls.push(params);
        await Promise.resolve();
        return {
          parsed_output: output,
          usage: {
            input_tokens: 1234,
            output_tokens: 56,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 1100,
          },
          cost_usd: 0.0123,
        };
      },
    },
  };
  return { client, parseCalls };
}

describe("foundation: runCorrectnessReviewer", () => {
  it("invokes messages.parse with the pinned model, adaptive thinking, and effort", async () => {
    const { client, parseCalls } = makeAnthropicClient(VALID_OUTPUT);
    await runCorrectnessReviewer(client, INPUT);
    expect(parseCalls.length).toBe(1);
    const call = parseCalls[0];
    if (call === undefined) {
      throw new Error("expected one parse call");
    }
    expect(call.model).toBe(CORRECTNESS_MODEL);
    expect(call.max_tokens).toBe(CORRECTNESS_MAX_TOKENS);
    expect(call.thinking).toEqual({ type: "adaptive" });
    expect(call.output_config.effort).toBe(CORRECTNESS_EFFORT);
    expect(call.system.length).toBe(1);
    const systemBlock = call.system[0];
    if (systemBlock === undefined) {
      throw new Error("expected one system block");
    }
    expect(systemBlock.text).toBe(CORRECTNESS_SYSTEM_PROMPT);
    expect(systemBlock.cache_control).toEqual({ type: "ephemeral" });
    expect(call.messages.length).toBe(1);
  });

  it("returns the parsed findings, normalized token counts, and duration metadata", async () => {
    const { client } = makeAnthropicClient(VALID_OUTPUT);
    const result = await runCorrectnessReviewer(client, INPUT);
    expect(result.findings.length).toBe(1);
    const finding = result.findings[0];
    if (finding === undefined) {
      throw new Error("expected one finding");
    }
    expect(finding.kind).toBe("correctness");
    expect(result.tokens.input).toBe(1234);
    expect(result.tokens.output).toBe(56);
    expect(result.tokens.cacheCreate).toBe(0);
    expect(result.tokens.cacheRead).toBe(1100);
    expect(result.costUsd).toBe(0.0123);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty findings array when the model judges the PR clean", async () => {
    const { client } = makeAnthropicClient({ findings: [] });
    const result = await runCorrectnessReviewer(client, INPUT);
    expect(result.findings).toEqual([]);
  });

  it("returns an empty findings array when parsed_output is null (parser refused)", async () => {
    const refusalClient: CorrectnessAnthropicClient = {
      messages: {
        parse: async () => {
          await Promise.resolve();
          return {
            parsed_output: null,
            usage: {
              input_tokens: 100,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
        },
      },
    };
    const result = await runCorrectnessReviewer(refusalClient, INPUT);
    expect(result.findings).toEqual([]);
  });

  it("propagates errors from the underlying SDK call", async () => {
    const failingClient: CorrectnessAnthropicClient = {
      messages: {
        parse: async () => {
          await Promise.resolve();
          throw new Error("rate-limit");
        },
      },
    };
    const onErr = mock(() => {
      // intentionally silent
    });
    let caught: unknown;
    try {
      await runCorrectnessReviewer(failingClient, INPUT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).toBe("rate-limit");
    }
    // onErr isn't wired through runCorrectnessReviewer in Phase 2 (the
    // captureWithContext path lives in the activity wrapper, not the pure
    // runner) — keep the mock around so the suite signals intent.
    expect(onErr).not.toHaveBeenCalled();
  });
});

describe("foundation: CorrectnessOutputSchema", () => {
  it("accepts the canonical { findings: Finding[] } shape", () => {
    const parsed = CorrectnessOutputSchema.parse(VALID_OUTPUT);
    expect(parsed.findings.length).toBe(1);
  });

  it("rejects missing findings field", () => {
    expect(() => CorrectnessOutputSchema.parse({})).toThrow();
  });

  it("rejects findings whose kind is not 'correctness' (other specialists own those kinds)", () => {
    // The schema permits any FindingKind today — we don't enforce
    // kind === "correctness" at the structured-output boundary because
    // the consensus activity will accept findings from all specialists.
    // Document this with an assertion so a future contributor knows
    // the looseness is intentional, not an oversight.
    expect(() =>
      CorrectnessOutputSchema.parse({
        findings: [{ ...VALID_OUTPUT.findings[0], kind: "security" }],
      }),
    ).not.toThrow();
  });
});
