import { describe, expect, it } from "vitest";
import {
  BackfillOpenPrCodeReviewsInputSchema,
  ClaimProviderSignalPayloadSchema,
  CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
  CODE_REVIEW_STATUS_CONTEXT,
  CodeReviewSettingsSchema,
  DEFAULT_CODE_REVIEW_SETTINGS,
  DEFAULT_CODE_REVIEW_SETTINGS_JSON,
  PrCodeReviewWorkflowInputSchema,
  ProviderAssignmentPayloadSchema,
  prCodeReviewWorkflowId,
  ReportProviderOutcomePayloadSchema,
} from "./code-review.ts";

describe("shared code-review contracts", () => {
  it("defines stable status context and workflow IDs", () => {
    expect(CODE_REVIEW_STATUS_CONTEXT).toBe("ci/code-review");
    expect(CODE_REVIEW_COORDINATOR_WORKFLOW_ID).toBe("code-review-coordinator");
    expect(
      prCodeReviewWorkflowId("shepherdjerred", "monorepo", 2401, "abc1234"),
    ).toBe("pr-code-review/shepherdjerred/monorepo/2401/abc1234");
    expect(prCodeReviewWorkflowId("org-a", "b", 1, "sha1")).not.toBe(
      prCodeReviewWorkflowId("org", "a-b", 1, "sha1"),
    );
  });

  it("parses default JSON settings and fills omitted timeout defaults", () => {
    const parsedDefault = CodeReviewSettingsSchema.parse(
      JSON.parse(DEFAULT_CODE_REVIEW_SETTINGS_JSON),
    );
    expect(parsedDefault).toEqual(DEFAULT_CODE_REVIEW_SETTINGS);

    const partial = CodeReviewSettingsSchema.parse({
      weights: { coderabbit: 2, codex: 1 },
    });
    expect(partial).toEqual({
      weights: { coderabbit: 2, codex: 1 },
      quotaCooldownSeconds: 3600,
      timeoutCooldownSeconds: 900,
      requestRetrySeconds: 720,
      providerTimeoutSeconds: 1500,
    });
  });

  it.each([
    { weights: { unknown: 1 } },
    { weights: { coderabbit: -1 } },
    { weights: { coderabbit: 1.5 } },
    { weights: { coderabbit: 1 }, quotaCooldownSeconds: 0 },
    { weights: { coderabbit: 1 }, timeoutCooldownSeconds: -5 },
    { weights: { coderabbit: 1 }, requestRetrySeconds: 0 },
    { weights: { coderabbit: 1 }, providerTimeoutSeconds: 0 },
    { weights: { coderabbit: 1 }, extraField: true },
  ])("rejects invalid settings shape %j", (invalid) => {
    expect(() => CodeReviewSettingsSchema.parse(invalid)).toThrow();
  });

  it("validates coordinator signal and workflow payloads", () => {
    const claim = ClaimProviderSignalPayloadSchema.parse({
      requestId: "req-1",
      replyWorkflowId: "pr-code-review-shepherdjerred-monorepo-42",
      replyRunId: "run-1",
      prNumber: 42,
      headSha: "abc1234",
      author: { login: "shepherdjerred", type: "User" },
      weights: { coderabbit: 3, codex: 1 },
      excludeProviders: ["greptile"],
      nowMs: 1_700_000_000_000,
    });
    expect(claim.weights).toEqual({ coderabbit: 3, codex: 1 });

    expect(
      ProviderAssignmentPayloadSchema.parse({
        requestId: "req-1",
        selection: { kind: "assigned", providerId: "coderabbit" },
      }),
    ).toEqual({
      requestId: "req-1",
      selection: { kind: "assigned", providerId: "coderabbit" },
    });

    expect(
      ReportProviderOutcomePayloadSchema.parse({
        providerId: "coderabbit",
        outcome: "usage-limited",
        cooldownMs: 3_600_000,
        nowMs: 1_700_000_000_000,
      }),
    ).toMatchObject({ providerId: "coderabbit", outcome: "usage-limited" });

    expect(
      PrCodeReviewWorkflowInputSchema.parse({
        owner: "shepherdjerred",
        repo: "monorepo",
        prNumber: 42,
        headSha: "abc1234",
        baseRef: "main",
        watchIteration: 1,
        assignedProviderId: null,
      }),
    ).toMatchObject({ prNumber: 42, assignedProviderId: null });

    expect(
      BackfillOpenPrCodeReviewsInputSchema.parse({
        owner: "shepherdjerred",
        repo: "monorepo",
      }),
    ).toEqual({ owner: "shepherdjerred", repo: "monorepo" });
  });
});
