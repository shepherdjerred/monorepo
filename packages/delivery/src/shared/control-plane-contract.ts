import { z } from "zod";
import {
  ArtifactVersionSchema,
  IdentifierSchema,
} from "./artifact-contract.ts";
import { PlatformSourceSchema } from "./platform-contract.ts";

export const ControlPlanePipelineSchema = z
  .object({
    kind: z.literal("control-plane"),
    application: z.literal("delivery-control-plane"),
    namespace: z.literal("temporal"),
    chartRepository: z.literal("https://chartmuseum.tailnet-1a49.ts.net"),
    chartName: z.literal("delivery-control-plane"),
    chartComponent: z.literal("chart:delivery-control-plane"),
    runnerImage: z
      .string()
      .regex(/^docker\.io\/shepherdjerred\/ci-base@sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export const RequestControlPlaneUpgradeSchema = z
  .object({
    requestId: IdentifierSchema,
    expectedGeneration: z.number().int().nonnegative(),
    imageArtifactId: IdentifierSchema,
    chartArtifactId: IdentifierSchema,
    previousImageArtifactId: IdentifierSchema.optional(),
    priorChartArtifactId: IdentifierSchema.optional(),
    reason: z.string().trim().min(10).max(4000),
  })
  .strict();
export type RequestControlPlaneUpgrade = z.infer<
  typeof RequestControlPlaneUpgradeSchema
>;

export const ControlPlaneUpgradeSnapshotSchema = z
  .object({
    schema: z.literal("delivery-control-plane/v1"),
    source: PlatformSourceSchema,
    previousArtifact: ArtifactVersionSchema,
    nextArtifact: ArtifactVersionSchema,
    priorChartArtifact: ArtifactVersionSchema,
    priorSelectionManaged: z.boolean().default(false),
    chartArtifact: ArtifactVersionSchema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const image = snapshot.nextArtifact;
    if (
      image.kind !== "image" ||
      image.component !== "image:temporal-worker" ||
      image.serviceId !== "temporal" ||
      image.uri !== "docker.io/shepherdjerred/temporal-worker" ||
      image.origin.kind !== "first-party" ||
      snapshot.chartArtifact.buildId !== snapshot.source.id ||
      snapshot.chartArtifact.sourceRevision !== snapshot.source.sourceRevision
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Control-plane image must retain its original qualification and chart must retain the exact qualified source build",
      });
    if (
      snapshot.chartArtifact.kind !== "chart" ||
      snapshot.chartArtifact.component !== "chart:delivery-control-plane" ||
      snapshot.chartArtifact.serviceId !== "delivery-control-plane" ||
      snapshot.chartArtifact.origin.kind !== "first-party" ||
      snapshot.priorChartArtifact.kind !== "chart" ||
      snapshot.priorChartArtifact.component !==
        "chart:delivery-control-plane" ||
      snapshot.priorChartArtifact.serviceId !== "delivery-control-plane"
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Control-plane snapshot requires the dedicated controller chart and its original owner",
      });
  });
export type ControlPlaneUpgradeSnapshot = z.infer<
  typeof ControlPlaneUpgradeSnapshotSchema
>;

export const ControlPlaneAcceptanceSchema = z
  .object({
    adapter: z.literal("control-plane"),
    previousArtifactId: IdentifierSchema,
    nextArtifactId: IdentifierSchema,
    chartArtifactId: IdentifierSchema,
    nativeJobUID: z.uuid(),
    argoOperationId: z.uuid(),
    argoRequestId: z.uuid(),
  })
  .strict();
