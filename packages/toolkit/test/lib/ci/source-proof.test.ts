import { expect, test } from "vitest";
import { collectSourceProof, SourceProofSchema } from "#lib/ci/source-proof.ts";
import { evaluateReadiness, type Snapshot } from "#lib/ci/readiness.ts";
import { ciFixture, CI_BASE, CI_HEAD } from "./fixtures.ts";
import { WoodpeckerPipelineSchema } from "#lib/woodpecker/ci.ts";

function merged(): Snapshot {
  const snapshot = ciFixture();
  snapshot.pr.merged = true;
  snapshot.pr.state = "closed";
  snapshot.pr.mergeable = null;
  if (snapshot.pipeline === null)
    throw new Error("Expected native fixture pipeline");
  snapshot.pipeline.finished = 1234;
  snapshot.pipeline = WoodpeckerPipelineSchema.parse({
    ...snapshot.pipeline,
    // Native pipeline identities from the generator and observed CI; the API
    // schema preserves these keys without translating the review workflow.
    workflows: [
      { name: "verify", state: "success" },
      { name: "codex-review-gate", state: "success" },
      { name: "ci-complete", state: "success" },
    ],
  });
  return snapshot;
}
function prove(snapshot: Snapshot, after = snapshot) {
  let reads = 0;
  return collectSourceProof(CI_HEAD, {
    snapshot: () => Promise.resolve(reads++ === 0 ? snapshot : after),
    compare: (source, main) => {
      expect(source).toBe(CI_HEAD);
      expect(main).toBe(CI_BASE);
      return Promise.resolve({
        status: "ahead" as const,
        base_commit: { sha: CI_HEAD },
        merge_base_commit: { sha: CI_HEAD },
      });
    },
  });
}
test("post-merge proof retains exact reviewed head identity independently of merge/main SHA without changing normal readiness", async () => {
  const snapshot = merged();
  const result = SourceProofSchema.parse(await prove(snapshot));
  expect(result).toMatchObject({
    sourceRevision: CI_HEAD,
    mainRevision: CI_BASE,
    pipelineNumber: 7,
    pullRequest: 99,
    reviewEvidence: {
      headRevision: CI_HEAD,
      requiredApprovals: 0,
      requiredChecks: [{ state: "pass" }, { state: "pass" }],
    },
  });
  expect(evaluateReadiness(snapshot, CI_HEAD).outcome).toBe("pr_closed");
});
test.each([
  "unmerged",
  "closed-unmerged",
  "wrong-head",
  "merge-sha",
  "failed-ci",
  "missing-review",
  "failed-review",
  "pending-check",
  "draft",
  "human-review",
])(
  "source proof rejects %s rather than borrowing or weakening gates",
  async (failure) => {
    const snapshot = merged();
    if (snapshot.pipeline === null) throw new Error("Expected fixture");
    switch (failure) {
      case "unmerged":
        snapshot.pr.state = "open";
        snapshot.pr.merged = false;
        break;
      case "closed-unmerged":
        snapshot.pr.merged = false;
        break;
      case "wrong-head":
        snapshot.pr.head.sha = "c".repeat(40);
        break;
      case "merge-sha":
        snapshot.pipeline.commit = CI_BASE;
        break;
      case "failed-ci":
        snapshot.pipeline.status = "failure";
        break;
      case "missing-review":
        snapshot.pipeline.workflows = snapshot.pipeline.workflows.filter(
          (workflow) => workflow.name !== "codex-review-gate",
        );
        break;
      case "failed-review":
        snapshot.pipeline.workflows = snapshot.pipeline.workflows.map(
          (workflow) =>
            workflow.name === "codex-review-gate"
              ? { ...workflow, state: "failure" }
              : workflow,
        );
        break;
      case "pending-check":
        snapshot.checks[0] = {
          name: "ci/merge-conflict",
          state: "pending",
          url: null,
          appId: null,
        };
        break;
      case "draft":
        snapshot.pipeline.pr_draft = true;
        break;
      case "human-review":
        snapshot.rules.approvals = 1;
        snapshot.reviewDecision = "CHANGES_REQUESTED";
        break;
      default:
        throw new Error("Unknown failure case");
    }
    await expect(prove(snapshot)).rejects.toThrow();
  },
);
test.each(["behind", "diverged"] as const)(
  "merged PR flag alone cannot prove main ancestry (%s)",
  async (status) => {
    await expect(
      collectSourceProof(CI_HEAD, {
        snapshot: () => Promise.resolve(merged()),
        compare: () =>
          Promise.resolve({
            status,
            base_commit: { sha: CI_HEAD },
            merge_base_commit: { sha: "c".repeat(40) },
          }),
      }),
    ).rejects.toThrow("not an ancestor");
  },
);
test("final independent snapshot must still match source, current main and successful reviews", async () => {
  const before = merged(),
    changedMain = merged(),
    changedReview = merged();
  changedMain.main.headSha = "c".repeat(40);
  changedReview.rules.approvals = 1;
  changedReview.reviewDecision = "REVIEW_REQUIRED";
  await expect(prove(before, changedMain)).rejects.toThrow("identity changed");
  await expect(prove(before, changedReview)).rejects.toThrow(
    "review is blocked",
  );
});
test("unrelated main verdict remains evidence rather than replacing the exact-source gates", async () => {
  const snapshot = merged();
  snapshot.main.state = "red";
  expect(await prove(snapshot)).toMatchObject({
    sourceRevision: CI_HEAD,
    mainRevision: CI_BASE,
    mainState: "red",
  });
});
test("a successful invented review alias cannot replace the native codex-review-gate workflow", async () => {
  const snapshot = merged();
  if (snapshot.pipeline === null) throw new Error("Expected fixture");
  snapshot.pipeline.workflows = snapshot.pipeline.workflows.map((workflow) =>
    workflow.name === "codex-review-gate"
      ? { ...workflow, name: "code-review" }
      : workflow,
  );
  await expect(prove(snapshot)).rejects.toThrow("native review gate");
});
