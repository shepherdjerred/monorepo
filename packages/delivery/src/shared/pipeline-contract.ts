import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
import { StaticSitePolicySchema } from "./static-site-contract.ts";
import * as controlPlane from "./control-plane-contract.ts";
import * as platform from "./platform-contract.ts";
export const PipelineDefinitionSchema = z.discriminatedUnion("kind", [
  controlPlane.ControlPlanePipelineSchema,
  z
    .object({
      kind: z.literal("argocd"),
      application: IdentifierSchema,
      chartRepository: z.url(),
      chartName: IdentifierSchema,
      chartComponent: IdentifierSchema,
      namespace: IdentifierSchema.optional(),
      parameters: z.record(z.string(), z.string()),
      artifactParameters: z.record(z.string(), IdentifierSchema).default({}),
      verification: z
        .object({
          url: z.url(),
          expectedStatus: z.number().int().min(200).max(299),
        })
        .optional(),
      workerRollout: z
        .object({
          target: z.enum(["central", "scout-beta", "scout-prod"]),
          imageComponent: IdentifierSchema,
          runnerImage: z
            .string()
            .regex(/^docker\.io\/shepherdjerred\/ci-base@sha256:[a-f0-9]{64}$/),
        })
        .strict()
        .optional(),
      forumRelease: z
        .object({
          imageComponent: IdentifierSchema,
          bundleComponent: IdentifierSchema,
        })
        .strict()
        .optional(),
      minecraftUpgrade: z
        .object({
          imageComponent: z.literal("image:the-storm-server"),
          runnerImage: z
            .string()
            .regex(/^docker\.io\/shepherdjerred\/ci-base@sha256:[a-f0-9]{64}$/),
        })
        .strict()
        .optional(),
      scoutSite: StaticSitePolicySchema.optional(),
      trmnlPlugins: z
        .object({ archiveComponent: z.literal("archive:trmnl-plugins") })
        .strict()
        .optional(),
    })
    .strict(),
  StaticSitePolicySchema.extend({ kind: z.literal("static-site") }),
  platform.RootReleasePipelineSchema,
  platform.TofuPipelineSchema,
  z.object({ kind: z.literal("manual"), reason: z.string().min(1) }).strict(),
]);
