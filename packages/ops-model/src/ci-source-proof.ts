import { z } from "zod";

const Revision = z.string().regex(/^[a-f0-9]{40}$/u);
const Trees = {
  sourceTreeRevision: Revision,
  mergeTreeRevision: Revision,
  mergeMainBaseRevision: Revision,
};
export const SourceProofSchema = z
  .object({
    schema: z.literal("delivery-source-proof/v2"),
    sourceRevision: Revision,
    mergeRevision: Revision,
    pullRequest: z.number().int().positive(),
    mainRevision: Revision,
    mainState: z.enum(["green", "red", "pending"]),
    pipelineNumber: z.number().int().positive(),
    pipelineUrl: z.url(),
    verifiedAt: z.iso.datetime(),
    integrationProof: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("reviewed-head-ancestor"),
          ...Trees,
          sourceMergeBaseRevision: Revision,
        })
        .strict(),
      z.object({ kind: z.literal("squash-tree-equality"), ...Trees }).strict(),
    ]),
    reviewEvidence: z
      .object({
        headRevision: Revision,
        requiredApprovals: z.number().int().nonnegative(),
        reviewDecision: z
          .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
          .nullable(),
        requiredChecks: z
          .array(
            z
              .object({
                name: z.string(),
                appId: z.number().nullable(),
                state: z.literal("pass"),
                url: z.string().nullable(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const proof = value.integrationProof;
    if (
      value.reviewEvidence.headRevision !== value.sourceRevision ||
      proof.mergeMainBaseRevision !== value.mergeRevision ||
      (proof.kind === "reviewed-head-ancestor"
        ? proof.sourceMergeBaseRevision !== value.sourceRevision
        : proof.sourceTreeRevision !== proof.mergeTreeRevision)
    )
      context.addIssue({
        code: "custom",
        message: "Source integration proof identities differ",
      });
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
