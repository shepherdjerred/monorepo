import { z } from "zod";
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
export const SourceProofSchema = z
  .object({
    schema: z.literal("delivery-source-proof/v1"),
    sourceRevision: Revision,
    pullRequest: z.number().int().positive(),
    mainRevision: Revision,
    mainState: z.enum(["green", "red", "pending"]),
    pipelineNumber: z.number().int().positive(),
    pipelineUrl: z.url(),
    verifiedAt: z.iso.datetime(),
    reviewEvidence: z
      .object({
        headRevision: Revision,
        requiredApprovals: z.number().int().nonnegative(),
        reviewDecision: z
          .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
          .nullable(),
        requiredChecks: z
          .array(
            z.object({
              name: z.string(),
              appId: z.number().nullable(),
              state: z.literal("pass"),
              url: z.string().nullable(),
            }),
          )
          .min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.pipelineUrl !==
      `https://woodpecker.sjer.red/repos/1/pipeline/${String(value.pipelineNumber)}`
    )
      context.addIssue({
        code: "custom",
        message:
          "Bootstrap source proof requires the canonical monorepo Woodpecker pipeline",
      });
  });
export type SourceProof = z.infer<typeof SourceProofSchema>;

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
  effects: {
    snapshot: () => Promise<Snapshot>;
    compare: (
      sourceRevision: string,
      mainRevision: string,
    ) => Promise<z.infer<typeof SourceAncestrySchema>>;
  },
): Promise<SourceProof> {
  Revision.parse(source);
  const before = await effects.snapshot();
  requireSource(before, source);
  const ancestry = SourceAncestrySchema.parse(
    await effects.compare(source, before.main.headSha),
  );
  if (
    !["ahead", "identical"].includes(ancestry.status) ||
    ancestry.base_commit.sha !== source ||
    ancestry.merge_base_commit.sha !== source
  )
    throw new Error(
      "Reviewed source is not an ancestor of the independently observed current main",
    );
  const after = await effects.snapshot();
  const { pipeline, checks, pipelineUrl } = requireSource(after, source);
  if (
    after.main.headSha !== before.main.headSha ||
    after.pr.number !== before.pr.number
  )
    throw new Error(
      "Main or PR identity changed during source-proof collection; retry the bounded read",
    );
  return SourceProofSchema.parse({
    schema: "delivery-source-proof/v1",
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
