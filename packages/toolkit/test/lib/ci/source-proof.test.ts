import { expect, test, vi } from "vitest";
import { collectSourceProof } from "#lib/ci/source-proof.ts";
import { SourceProofSchema } from "@shepherdjerred/ops-model/ci-source-proof.ts";
import { evaluateReadiness, type Snapshot } from "#lib/ci/readiness.ts";
import { ciFixture, CI_BASE, CI_HEAD } from "./fixtures.ts";
import { WoodpeckerPipelineSchema } from "#lib/woodpecker/ci.ts";

const MERGE = "c".repeat(40);
const TREE = "d".repeat(40);
const OTHER_TREE = "e".repeat(40);

function merged(): Snapshot {
  const snapshot = ciFixture();
  snapshot.pr.merged = true;
  snapshot.pr.merge_commit_sha = MERGE;
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
function effects(snapshot = merged(), after = snapshot) {
  let reads = 0;
  return {
    snapshot: () => Promise.resolve(reads++ === 0 ? snapshot : after),
    commit: (revision: string) =>
      Promise.resolve({
        sha: revision,
        tree: { sha: revision === CI_HEAD ? TREE : OTHER_TREE },
      }),
    compare: (base: string, head: string) => {
      expect([CI_HEAD, MERGE]).toContain(base);
      expect(head).toBe(base === CI_HEAD ? MERGE : CI_BASE);
      return Promise.resolve({
        status: "ahead" as const,
        base_commit: { sha: base },
        merge_base_commit: { sha: base },
      });
    },
  };
}
function prove(snapshot: Snapshot, after = snapshot) {
  return collectSourceProof(CI_HEAD, effects(snapshot, after));
}
function squashEffects() {
  const original = effects();
  return {
    ...original,
    commit: (revision: string) =>
      Promise.resolve({ sha: revision, tree: { sha: TREE } }),
    compare: (base: string, head: string) =>
      base === CI_HEAD
        ? Promise.resolve({
            status: "diverged" as const,
            base_commit: { sha: CI_HEAD },
            merge_base_commit: { sha: "f".repeat(40) },
          })
        : original.compare(base, head),
  };
}
test("post-merge proof retains exact reviewed head identity independently of merge/main SHA without changing normal readiness", async () => {
  const snapshot = merged();
  const result = SourceProofSchema.parse(await prove(snapshot));
  expect(result).toMatchObject({
    sourceRevision: CI_HEAD,
    mergeRevision: MERGE,
    mainRevision: CI_BASE,
    integrationProof: {
      kind: "reviewed-head-ancestor",
      sourceMergeBaseRevision: CI_HEAD,
      mergeMainBaseRevision: MERGE,
    },
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
        ...effects(),
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
test("squash merge proves identical Git trees while retaining reviewed head CI and its associated merge identity", async () => {
  const native = squashEffects();
  const commit = vi.fn(native.commit),
    compare = vi.fn(native.compare);
  const result = await collectSourceProof(CI_HEAD, {
    ...native,
    commit,
    compare,
  });
  expect(result).toMatchObject({
    schema: "delivery-source-proof/v2",
    sourceRevision: CI_HEAD,
    mergeRevision: MERGE,
    integrationProof: {
      kind: "squash-tree-equality",
      sourceTreeRevision: TREE,
      mergeTreeRevision: TREE,
      mergeMainBaseRevision: MERGE,
    },
    reviewEvidence: { headRevision: CI_HEAD },
  });
  expect(commit.mock.calls).toEqual([[CI_HEAD], [MERGE], [CI_HEAD], [MERGE]]);
  expect(compare.mock.calls).toEqual([
    [CI_HEAD, MERGE],
    [MERGE, CI_BASE],
    [CI_HEAD, MERGE],
    [MERGE, CI_BASE],
  ]);
});
test.each([
  "missing-associated-merge",
  "wrong-merge-object",
  "tree-mismatch",
  "merge-not-on-main",
])(
  "integration refuses %s instead of borrowing unrelated ancestry or reviews",
  async (failure) => {
    const native = squashEffects();
    const snapshot = merged();
    if (failure === "missing-associated-merge")
      snapshot.pr.merge_commit_sha = null;
    await expect(
      collectSourceProof(CI_HEAD, {
        ...native,
        snapshot: () => Promise.resolve(snapshot),
        commit: async (revision) => {
          const commit = await native.commit(revision);
          if (revision === MERGE && failure === "wrong-merge-object")
            commit.sha = CI_BASE;
          if (revision === MERGE && failure === "tree-mismatch")
            commit.tree.sha = OTHER_TREE;
          return commit;
        },
        compare: (base, head) =>
          failure === "merge-not-on-main" && base === MERGE
            ? Promise.resolve({
                status: "diverged",
                base_commit: { sha: MERGE },
                merge_base_commit: { sha: "f".repeat(40) },
              })
            : native.compare(base, head),
      }),
    ).rejects.toThrow();
  },
);
test("an ancestry response for main cannot substitute for reviewed-head ancestry of the associated merge", async () => {
  const native = squashEffects();
  await expect(
    collectSourceProof(CI_HEAD, {
      ...native,
      compare: (base, head) =>
        base === CI_HEAD
          ? Promise.resolve({
              status: "ahead",
              base_commit: { sha: CI_BASE },
              merge_base_commit: { sha: CI_HEAD },
            })
          : native.compare(base, head),
    }),
  ).rejects.toThrow("not bound to the reviewed source");
});
test.each(["merge", "pipeline", "checks", "reviews"])(
  "fresh snapshot rejects changed %s evidence",
  async (change) => {
    const before = merged(),
      after = merged();
    if (after.pipeline === null) throw new Error("Expected pipeline");
    if (change === "merge") after.pr.merge_commit_sha = "f".repeat(40);
    if (change === "pipeline") {
      after.pipeline.number++;
      after.pipelineUrl = `https://woodpecker.sjer.red/repos/1/pipeline/${String(after.pipeline.number)}`;
      after.checks[1]!.url = `${after.pipelineUrl}/2`;
    }
    if (change === "checks")
      after.checks[0]!.url = "https://github.com/shepherdjerred/monorepo";
    if (change === "reviews")
      after.reviews = [
        {
          id: 1,
          node_id: "review",
          user: { login: "reviewer", type: "User" },
          body: "Approved",
          html_url: "https://github.com/shepherdjerred/monorepo/pull/99",
          state: "APPROVED",
          submitted_at: "2026-10-17T00:00:00Z",
          commit_id: CI_HEAD,
        },
      ];
    await expect(prove(before, after)).rejects.toThrow("identity changed");
  },
);
test("second independent integration read must preserve exact trees and proof kind", async () => {
  const native = squashEffects();
  let reads = 0;
  await expect(
    collectSourceProof(CI_HEAD, {
      ...native,
      commit: async (revision) => {
        const result = await native.commit(revision);
        if (++reads > 2) result.tree.sha = OTHER_TREE;
        return result;
      },
    }),
  ).rejects.toThrow("proof changed");
});
test("canonical consumer rejects old unbound v1 and contradictory merge/tree/head proof fields", async () => {
  const proof = await collectSourceProof(CI_HEAD, squashEffects());
  for (const invalid of [
    { ...proof, schema: "delivery-source-proof/v1" },
    { ...proof, mergeRevision: CI_BASE },
    {
      ...proof,
      reviewEvidence: { ...proof.reviewEvidence, headRevision: MERGE },
    },
    {
      ...proof,
      integrationProof: {
        ...proof.integrationProof,
        mergeTreeRevision: OTHER_TREE,
      },
    },
  ])
    expect(SourceProofSchema.safeParse(invalid).success).toBe(false);
});
test("equal trees cannot hide a changed integration proof kind on the final read", async () => {
  const native = squashEffects();
  let sourceComparisons = 0;
  await expect(
    collectSourceProof(CI_HEAD, {
      ...native,
      compare: (base, head) =>
        base === CI_HEAD && ++sourceComparisons === 1
          ? Promise.resolve({
              status: "ahead",
              base_commit: { sha: CI_HEAD },
              merge_base_commit: { sha: CI_HEAD },
            })
          : native.compare(base, head),
    }),
  ).rejects.toThrow("proof changed");
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
