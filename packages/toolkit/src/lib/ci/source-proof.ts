import { z } from "zod";
import {
  SourceProofSchema,
  type SourceProof,
} from "@shepherdjerred/ops-model/ci-source-proof.ts";
import {
  pipelineState,
  requiredChecks,
  reviewBlockers,
  type Snapshot,
} from "./readiness.ts";

const Revision = z.string().regex(/^[a-f0-9]{40}$/u);
export const SourceAncestrySchema = z.object({
  status: z.enum(["ahead", "identical", "behind", "diverged"]),
  base_commit: z.object({ sha: Revision }),
  merge_base_commit: z.object({ sha: Revision }),
});
export const SourceGitCommitSchema = z.object({
  sha: Revision,
  tree: z.object({ sha: Revision }),
});
type SourceEffects = {
  snapshot: () => Promise<Snapshot>;
  compare: (
    base: string,
    head: string,
  ) => Promise<z.infer<typeof SourceAncestrySchema>>;
  commit: (revision: string) => Promise<z.infer<typeof SourceGitCommitSchema>>;
};

function ancestor(
  observation: z.infer<typeof SourceAncestrySchema>,
  base: string,
) {
  return (
    ["ahead", "identical"].includes(observation.status) &&
    observation.base_commit.sha === base &&
    observation.merge_base_commit.sha === base
  );
}

async function integration(
  snapshot: Snapshot,
  source: string,
  effects: SourceEffects,
) {
  const mergeRevision = Revision.parse(snapshot.pr.merge_commit_sha);
  const [sourceCommit, mergeCommit, sourceMerge, mergeMain] = await Promise.all(
    [
      effects.commit(source),
      effects.commit(mergeRevision),
      effects.compare(source, mergeRevision),
      effects.compare(mergeRevision, snapshot.main.headSha),
    ],
  );
  const original = SourceGitCommitSchema.parse(sourceCommit);
  const merged = SourceGitCommitSchema.parse(mergeCommit);
  const sourceAncestry = SourceAncestrySchema.parse(sourceMerge);
  if (sourceAncestry.base_commit.sha !== source)
    throw new Error("Git comparison is not bound to the reviewed source");
  if (original.sha !== source || merged.sha !== mergeRevision)
    throw new Error(
      "Git commit observation differs from the reviewed source or associated PR merge",
    );
  if (!ancestor(SourceAncestrySchema.parse(mergeMain), mergeRevision))
    throw new Error("Associated PR merge is not an ancestor of current main");
  const trees = {
    sourceTreeRevision: original.tree.sha,
    mergeTreeRevision: merged.tree.sha,
    mergeMainBaseRevision: mergeRevision,
  };
  if (ancestor(sourceAncestry, source))
    return {
      mergeRevision,
      integrationProof: {
        kind: "reviewed-head-ancestor" as const,
        ...trees,
        sourceMergeBaseRevision: source,
      },
    };
  if (original.tree.sha !== merged.tree.sha)
    throw new Error(
      "Reviewed source is not an ancestor of its PR merge and their Git trees differ; update and review the source",
    );
  return {
    mergeRevision,
    integrationProof: { kind: "squash-tree-equality" as const, ...trees },
  };
}

function evidenceIdentity(snapshot: Snapshot) {
  const { pipeline, checks, pipelineUrl } = requireSource(
    snapshot,
    snapshot.pr.head.sha,
  );
  return JSON.stringify({
    pr: snapshot.pr.number,
    source: snapshot.pr.head.sha,
    merge: snapshot.pr.merge_commit_sha,
    main: snapshot.main.headSha,
    pipeline,
    pipelineUrl,
    checks,
    rules: snapshot.rules,
    reviews: snapshot.reviews,
    reviewDecision: snapshot.reviewDecision,
  });
}

function requireSource(snapshot: Snapshot, source: string) {
  if (
    snapshot.consistent !== true ||
    snapshot.pr.head.sha !== source ||
    snapshot.pipeline?.commit !== source
  )
    throw new Error(
      "Source must equal the independently observed PR head and native pipeline commit; checks cannot be borrowed from a merge SHA",
    );
  if (
    !snapshot.pr.merged ||
    snapshot.pr.state !== "closed" ||
    snapshot.pr.base.ref !== "main"
  )
    throw new Error(
      "Bootstrap source requires an actually merged PR targeting main",
    );
  const pipeline = snapshot.pipeline;
  if (
    pipelineState(pipeline) !== "pass" ||
    pipeline.status !== "success" ||
    (pipeline.finished ?? 0) <= 0 ||
    !["ci-complete", "codex-review-gate"].every((name) =>
      pipeline.workflows.some(
        (workflow) => workflow.name === name && workflow.state === "success",
      ),
    )
  )
    throw new Error(
      "Exact source requires a successful completed whole pipeline, full CI completion and native review gate",
    );
  const blockers = reviewBlockers(snapshot);
  if (blockers.length > 0)
    throw new Error(`Exact source review is blocked: ${blockers.join("; ")}`);
  const checks = requiredChecks(snapshot);
  if (checks.length === 0 || checks.some((check) => check.state !== "pass"))
    throw new Error(
      "Exact source required checks have not all passed on its selected pipeline",
    );
  if (snapshot.pipelineUrl === undefined || snapshot.pipelineUrl === null)
    throw new Error("Exact source native pipeline URL is unavailable");
  return { pipeline, checks, pipelineUrl: snapshot.pipelineUrl };
}

/** Distinct post-merge bootstrap evidence; ordinary merge-readiness semantics stay unchanged. */
export async function collectSourceProof(
  source: string,
  effects: SourceEffects,
): Promise<SourceProof> {
  Revision.parse(source);
  const before = await effects.snapshot();
  requireSource(before, source);
  const initialIntegration = await integration(before, source, effects);
  const after = await effects.snapshot();
  const { pipeline, checks, pipelineUrl } = requireSource(after, source);
  if (evidenceIdentity(after) !== evidenceIdentity(before))
    throw new Error(
      "Source, merge, main, pipeline or review identity changed during source-proof collection; retry the bounded read",
    );
  const finalIntegration = await integration(after, source, effects);
  if (JSON.stringify(initialIntegration) !== JSON.stringify(finalIntegration))
    throw new Error(
      "Source integration proof changed during collection; retry the bounded read",
    );
  return SourceProofSchema.parse({
    schema: "delivery-source-proof/v2",
    ...finalIntegration,
    sourceRevision: source,
    pullRequest: after.pr.number,
    mainRevision: after.main.headSha,
    mainState: after.main.state,
    pipelineNumber: pipeline.number,
    pipelineUrl,
    verifiedAt: new Date().toISOString(),
    reviewEvidence: {
      headRevision: after.pr.head.sha,
      requiredApprovals: after.rules.approvals,
      reviewDecision: after.reviewDecision,
      requiredChecks: checks,
    },
  });
}
