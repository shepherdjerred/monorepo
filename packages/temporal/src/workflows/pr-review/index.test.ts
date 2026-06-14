import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { BootstrapResult } from "#activities/pr-review/bootstrap.ts";
import type { AnnotatedFinding } from "#activities/pr-review/consensus.ts";
import type { PostReviewInput } from "#activities/pr-review/post-render.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import { prReviewPipeline } from "./index.ts";

const TASK_QUEUE = "pr-review-pipeline-test";

let testEnv: TestWorkflowEnvironment | undefined;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

function requireTestEnv(): TestWorkflowEnvironment {
  if (testEnv === undefined) {
    throw new Error("Temporal test environment was not initialized");
  }
  return testEnv;
}

const PIPELINE: PrReviewPipelineInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 1234,
  commitSha: "abc1234567890abc1234567890abc1234567890ab",
  baseRef: "main",
  headRef: "feature/foo",
  prTitle: "Add foo support",
  prAuthor: "alice",
};

const PATCHED_CONTEXT: BootstrapResult = {
  workdir: "/tmp/pr-review-test",
  changedFiles: [
    {
      path: "packages/foo/src/api.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: [
        "@@ -39,2 +39,3 @@ export function getUser(id: string) {",
        ' const prefix = "user";',
        '+return db.query("select * from users where id=" + id);',
      ].join("\n"),
    },
  ],
  claudeMdHierarchy: [],
  retrievedSymbols: [],
  blockDiffs: [],
  skipReviewReason: null,
};

const FINDING: Finding = {
  id: "det-sql-injection",
  file: "packages/foo/src/api.ts",
  lineStart: 40,
  lineEnd: 40,
  kind: "security",
  severity: "warning",
  verifier: "grep",
  verifierTarget: {
    kind: "grep",
    pattern: "db.query",
    isLiteral: true,
    pathGlob: "packages/foo/src/api.ts",
    mustMatch: true,
  },
  claim: "SQL injection via unparameterized query in `getUser`",
  evidence: "The changed line concatenates user-controlled input into SQL.",
  confidence: 0.95,
};

const VERIFIED_FINDING: Finding = {
  ...FINDING,
  verification: {
    status: "verified",
    verifier: "grep",
    exitCode: 0,
    outputExcerpt: "db.query",
    durationMs: 10,
  },
};

function annotatedFinding(passId: number): AnnotatedFinding {
  return { finding: FINDING, specialistId: "deterministic", passId };
}

async function resolvedVoid(): Promise<void> {
  await Promise.resolve();
}

describe("prReviewPipeline", () => {
  it("passes verified anchored findings and stage counts into the post activity", async () => {
    const postInputs: PostReviewInput[] = [];
    const env = requireTestEnv();

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("../index.ts", import.meta.url).pathname,
      activities: {
        prReviewPostStatus: async () => ({ commentId: 1, created: true }),
        prReviewBootstrap: async () => PATCHED_CONTEXT,
        prReviewDeterministicSignals: async () => [
          annotatedFinding(0),
          annotatedFinding(1),
        ],
        prReviewRunSpecialists: async () => [],
        prReviewConsensus: async () => [FINDING],
        prReviewVerify: async () => [VERIFIED_FINDING],
        prReviewDedupe: async () => [VERIFIED_FINDING],
        prReviewPost: async (input: PostReviewInput) => {
          postInputs.push(input);
          return {
            commentId: 99,
            created: true,
            inlineReviewId: 313,
            inlineCommentsPosted: 1,
            inlineCommentsSkippedUnanchored: 0,
            inlineCommentsSkippedDuplicate: 0,
            inlineCommentsSkippedUnverified: 0,
            inlineCommentsFailed: false,
          };
        },
        prReviewEmitMetrics: resolvedVoid,
        prReviewEmitFailureMetrics: resolvedVoid,
        prReviewTrack: resolvedVoid,
      },
    });

    const result = await worker.runUntil(
      env.client.workflow.execute(prReviewPipeline, {
        args: [PIPELINE],
        taskQueue: TASK_QUEUE,
        workflowId: "test-pr-review-pipeline-inline-flow",
      }),
    );

    expect(result.inlineCommentsPosted).toBe(1);
    expect(result.inlineReviewId).toBe(313);
    expect(postInputs).toHaveLength(1);
    const postInput = postInputs[0];
    if (postInput === undefined) {
      throw new Error("expected post activity input");
    }
    expect(postInput.findings).toEqual([VERIFIED_FINDING]);
    expect(postInput.changedFiles).toEqual(PATCHED_CONTEXT.changedFiles);
    expect(postInput.stageCounts).toEqual({
      deterministicFindings: 1,
      specialistFindings: 0,
      consensusFindings: 1,
      verifiedFindings: 1,
      dedupedFindings: 1,
    });
  }, 30_000);
});
