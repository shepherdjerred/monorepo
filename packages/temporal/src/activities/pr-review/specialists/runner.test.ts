import { describe, expect, it } from "bun:test";
import type { PrReviewContext } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import {
  buildSpecialistUserText,
  classifyAnthropicProviderError,
  resetAnthropicProviderErrorReporterForTests,
  runSpecialistPass,
  shouldReportAnthropicProviderError,
  specialistOutputSchema,
  type SpecialistAnthropicClient,
  type SpecialistConfig,
  type SpecialistOutput,
} from "./runner.ts";

class AnthropicRateLimitFixture extends Error {
  readonly status = 429;
  readonly error = { type: "rate_limit_error" };
}

const PIPELINE: PrReviewPipelineInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 999,
  commitSha: "abc1234567890",
  baseRef: "main",
  headRef: "feature/foo",
  prTitle: "Test PR",
  prAuthor: "alice",
};

const CONTEXT: PrReviewContext = {
  workdir: "",
  changedFiles: [
    {
      path: "a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@\n+const a = 1;",
    },
    {
      path: "b.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@\n+const b = 2;",
    },
    {
      path: "c.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@\n+const c = 3;",
    },
  ],
  claudeMdHierarchy: [],
  retrievedSymbols: [],
  blockDiffs: [],
};

const CFG: SpecialistConfig = {
  id: "security",
  kind: "security",
  model: "claude-opus-4-7",
  effort: "high",
  maxTokens: 16_000,
  systemPrompt: "security system prompt",
  maxFilesInPrompt: 150,
};

describe("specialistOutputSchema", () => {
  it("accepts findings whose kind matches the expected specialist kind", () => {
    const schema = specialistOutputSchema("security");
    const sample: SpecialistOutput = {
      findings: [
        {
          id: "f1",
          file: "a.ts",
          lineStart: 1,
          lineEnd: 1,
          kind: "security",
          severity: "warning",
          verifier: "none",
          claim: "x",
          evidence: "y",
          confidence: 0.7,
        },
      ],
    };
    expect(() => schema.parse(sample)).not.toThrow();
  });

  it("rejects findings whose kind does not match the specialist (encroachment guard)", () => {
    const schema = specialistOutputSchema("security");
    expect(() =>
      schema.parse({
        findings: [
          {
            id: "f1",
            file: "a.ts",
            lineStart: 1,
            lineEnd: 1,
            kind: "correctness", // wrong specialist
            severity: "warning",
            verifier: "none",
            claim: "x",
            evidence: "y",
            confidence: 0.7,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects findings with verifier!=none but no verifierTarget (Phase 4 contract)", () => {
    const schema = specialistOutputSchema("security");
    expect(() =>
      schema.parse({
        findings: [
          {
            id: "f1",
            file: "a.ts",
            lineStart: 1,
            lineEnd: 1,
            kind: "security",
            severity: "warning",
            verifier: "grep",
            // verifierTarget intentionally missing
            claim: "x",
            evidence: "y",
            confidence: 0.7,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects findings whose verifierTarget.kind disagrees with verifier", () => {
    const schema = specialistOutputSchema("security");
    expect(() =>
      schema.parse({
        findings: [
          {
            id: "f1",
            file: "a.ts",
            lineStart: 1,
            lineEnd: 1,
            kind: "security",
            severity: "warning",
            verifier: "grep",
            verifierTarget: {
              kind: "test",
              packagePath: "packages/x",
              testNamePattern: "foo",
              expectPass: true,
            },
            claim: "x",
            evidence: "y",
            confidence: 0.7,
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts verifier=grep findings with a matching grep verifierTarget", () => {
    const schema = specialistOutputSchema("security");
    expect(() =>
      schema.parse({
        findings: [
          {
            id: "f1",
            file: "a.ts",
            lineStart: 1,
            lineEnd: 1,
            kind: "security",
            severity: "warning",
            verifier: "grep",
            verifierTarget: {
              kind: "grep",
              pattern: "foo",
              isLiteral: true,
              pathGlob: "src/**",
              mustMatch: true,
            },
            claim: "x",
            evidence: "y",
            confidence: 0.7,
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("buildSpecialistUserText", () => {
  it("permutes file order across passes (pass 0 = identity, pass 1 != identity)", () => {
    const pass0 = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 0,
    });
    const pass1 = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 1,
    });
    // Pass 0 = identity: files appear in canonical order
    const a0 = pass0.indexOf("`a.ts`");
    const b0 = pass0.indexOf("`b.ts`");
    const c0 = pass0.indexOf("`c.ts`");
    expect(a0).toBeLessThan(b0);
    expect(b0).toBeLessThan(c0);
    // Pass 1: order differs from pass 0
    expect(pass1).not.toBe(pass0);
  });

  it("includes the specialist id and passId so the model can see its provenance", () => {
    const text = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 2,
    });
    expect(text).toContain("security #2");
  });

  it("omits the Related symbols section when no symbols were retrieved", () => {
    const text = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 0,
    });
    expect(text).not.toContain("Related symbols");
  });

  it("renders retrieved symbols above the Changed files section with the snippet inline", () => {
    const ctx: PrReviewContext = {
      ...CONTEXT,
      retrievedSymbols: [
        {
          entry: {
            name: "computeFoo",
            kind: "function",
            file: "packages/foo/src/index.ts",
            line: 42,
            endLine: 60,
          },
          score: 0.123,
          snippet: "export function computeFoo() {\n  return 1;\n}",
        },
      ],
    };
    const text = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: ctx,
      passId: 0,
    });
    expect(text).toContain("Related symbols (from code-graph retrieval)");
    expect(text).toContain("`computeFoo` (function)");
    expect(text).toContain("packages/foo/src/index.ts:42");
    expect(text).toContain("export function computeFoo()");
    // Section ordering: Related symbols precedes Changed files.
    const relatedIdx = text.indexOf("Related symbols");
    const filesIdx = text.indexOf("## Changed files");
    expect(relatedIdx).toBeGreaterThan(-1);
    expect(filesIdx).toBeGreaterThan(relatedIdx);
  });

  it("renders a placeholder for retrieved symbols when no snippet is available (workdir unstaged)", () => {
    const ctx: PrReviewContext = {
      ...CONTEXT,
      retrievedSymbols: [
        {
          entry: {
            name: "noSnippet",
            kind: "function",
            file: "x.ts",
            line: 1,
            endLine: 5,
          },
          score: 0.1,
          snippet: "",
        },
      ],
    };
    const text = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: ctx,
      passId: 0,
    });
    expect(text).toContain("snippet unavailable");
  });

  it("omits the AST block summary when no blockDiffs are present", () => {
    const text = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 0,
    });
    expect(text).not.toContain("AST block summary");
  });

  it("renders blockDiffs between Related symbols and Changed files, with the formatted block lines", () => {
    const ctx: PrReviewContext = {
      ...CONTEXT,
      blockDiffs: [
        {
          file: "a.ts",
          language: "typescript",
          blocks: [
            {
              kind: "function",
              name: "doThing",
              range: { startLine: 10, endLine: 30 },
              edit: "modified",
              addedLines: 5,
              removedLines: 2,
              modifiedSubBlocks: [],
            },
          ],
          orphanHunks: [],
          lineFallback: null,
        },
      ],
    };
    const text = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: ctx,
      passId: 0,
    });
    expect(text).toContain("AST block summary");
    expect(text).toContain("`doThing` (function) — modified");
    const astIdx = text.indexOf("AST block summary");
    const filesIdx = text.indexOf("## Changed files");
    expect(astIdx).toBeGreaterThan(-1);
    expect(filesIdx).toBeGreaterThan(astIdx);
  });

  it("renders lineFallback diffs for unsupported languages", () => {
    const ctx: PrReviewContext = {
      ...CONTEXT,
      blockDiffs: [
        {
          file: "x.py",
          language: null,
          blocks: [],
          orphanHunks: [],
          lineFallback: "@@ -1 +1 @@\n-a\n+b",
        },
      ],
    };
    const text = buildSpecialistUserText({
      config: CFG,
      pipeline: PIPELINE,
      context: ctx,
      passId: 0,
    });
    expect(text).toContain("`x.py`");
    expect(text).toContain("+b");
  });
});

const VALID_OUTPUT: SpecialistOutput = {
  findings: [
    {
      id: "f1",
      file: "a.ts",
      lineStart: 1,
      lineEnd: 1,
      kind: "security",
      severity: "warning",
      verifier: "grep",
      claim: "x",
      evidence: "y",
      confidence: 0.7,
    },
  ],
};

function makeClient(output: SpecialistOutput): {
  client: SpecialistAnthropicClient;
  parseCalls: Parameters<SpecialistAnthropicClient["messages"]["parse"]>[0][];
} {
  const parseCalls: Parameters<
    SpecialistAnthropicClient["messages"]["parse"]
  >[0][] = [];
  return {
    parseCalls,
    client: {
      messages: {
        parse: async (params) => {
          parseCalls.push(params);
          await Promise.resolve();
          return {
            parsed_output: output,
            usage: {
              input_tokens: 100,
              output_tokens: 10,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 90,
            },
            cost_usd: 0.005,
          };
        },
      },
    },
  };
}

describe("runSpecialistPass", () => {
  it("invokes the SDK with adaptive thinking, ephemeral cache, and the specialist's effort", async () => {
    const { client, parseCalls } = makeClient(VALID_OUTPUT);
    await runSpecialistPass(client, {
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 0,
    });
    expect(parseCalls).toHaveLength(1);
    const call = parseCalls[0];
    if (call === undefined) throw new Error("expected one parse call");
    expect(call.model).toBe("claude-opus-4-7");
    expect(call.thinking).toEqual({ type: "adaptive" });
    expect(call.output_config.effort).toBe("high");
    expect(call.system[0]?.text).toBe("security system prompt");
    expect(call.system[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns the parsed findings, duration, cost, and token bookkeeping", async () => {
    const { client } = makeClient(VALID_OUTPUT);
    const result = await runSpecialistPass(client, {
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 0,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.costUsd).toBe(0.005);
    expect(result.tokens.cacheRead).toBe(90);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty findings on parser refusal (parsed_output: null)", async () => {
    const refusalClient: SpecialistAnthropicClient = {
      messages: {
        parse: async () => {
          await Promise.resolve();
          return {
            parsed_output: null,
            usage: {
              input_tokens: 50,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
        },
      },
    };
    const result = await runSpecialistPass(refusalClient, {
      config: CFG,
      pipeline: PIPELINE,
      context: CONTEXT,
      passId: 0,
    });
    expect(result.findings).toEqual([]);
    expect(result.costUsd).toBeNull();
  });
});

describe("classifyAnthropicProviderError", () => {
  it("normalizes credit balance errors and extracts the request id", () => {
    const classification = classifyAnthropicProviderError(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"},"request_id":"req_abc123"}',
      ),
    );

    expect(classification).not.toBeNull();
    expect(classification?.kind).toBe("credit_balance_low");
    expect(classification?.captureMessage).toBe(
      "Anthropic provider error: credit_balance_low",
    );
    expect(classification?.fingerprint).toBe("anthropic-credit-balance-low");
    expect(classification?.requestId).toBe("req_abc123");
  });

  it("normalizes Anthropic rate limit errors", () => {
    const classification = classifyAnthropicProviderError(
      new AnthropicRateLimitFixture(
        "429 rate_limit_error request_id: req_rate_limit_1",
      ),
    );

    expect(classification).not.toBeNull();
    expect(classification?.kind).toBe("rate_limit");
    expect(classification?.captureMessage).toBe(
      "Anthropic provider error: rate_limit",
    );
    expect(classification?.fingerprint).toBe("anthropic-rate-limit");
    expect(classification?.requestId).toBe("req_rate_limit_1");
  });

  it("does not classify unrelated errors", () => {
    expect(
      classifyAnthropicProviderError(new Error("plain failure")),
    ).toBeNull();
  });
});

describe("shouldReportAnthropicProviderError", () => {
  it("captures one provider error per kind per reporting window", () => {
    resetAnthropicProviderErrorReporterForTests();
    const classification = classifyAnthropicProviderError(
      new Error("429 rate_limit_error request_id: req_1"),
    );
    if (classification === null) {
      throw new Error("expected rate limit classification");
    }

    const startMs = 1000;
    const fifteenMinutesMs = 15 * 60 * 1000;
    expect(shouldReportAnthropicProviderError(classification, startMs)).toBe(
      true,
    );
    expect(
      shouldReportAnthropicProviderError(
        classification,
        startMs + fifteenMinutesMs - 1,
      ),
    ).toBe(false);
    expect(
      shouldReportAnthropicProviderError(
        classification,
        startMs + fifteenMinutesMs,
      ),
    ).toBe(true);
  });
});
