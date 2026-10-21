import { z } from "zod";
import {
  ArtifactInputSchema,
  PublishBuildSchema,
} from "@shepherdjerred/delivery/contract";
import type { PublishBuild } from "@shepherdjerred/delivery/contract";
import {
  CATALOG_CORE,
  type CatalogCore,
  catalogOwnsService,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";
import {
  tofuArchiveArtifactId,
  tofuArchiveComponent,
  tofuArchiveServiceId,
  validateTofuArchiveUri,
} from "../tofu-archive.ts";

/** Build-scoped handoff written by the archive producer and read at registration. */
export const TOFU_ARCHIVE_HANDOFF = "tofu-archive-artifacts";

export const TofuArchivePublicationSchema = z
  .object({ serviceId: z.string().min(1), artifact: ArtifactInputSchema })
  .strict();
export type TofuArchivePublication = z.output<
  typeof TofuArchivePublicationSchema
>;

function stackOf(serviceId: string): TofuStack {
  const stack = TofuStackSchema.options.find(
    (candidate) => tofuArchiveServiceId(candidate) === serviceId,
  );
  if (stack === undefined)
    throw new Error(`Unknown OpenTofu archive service ${serviceId}`);
  return stack;
}

/**
 * Exactly one immutable archive per stack, in stack order.
 *
 * Every main run freezes every stack, so a missing stack means the producer
 * broke rather than that nothing changed. With `execution`, each artifact must
 * also carry this CI execution's identity, so a receipt cannot be replayed
 * from another pipeline.
 */
export function parseTofuArchivePublications(
  raw: unknown,
  execution?: { repositoryId: number; pipelineNumber: number },
): TofuArchivePublication[] {
  const entries = z.array(TofuArchivePublicationSchema).parse(raw);
  const byStack = new Map<TofuStack, TofuArchivePublication>();
  for (const entry of entries) {
    const stack = stackOf(entry.serviceId);
    if (byStack.has(stack))
      throw new Error(`OpenTofu archive handoff repeats stack ${stack}`);
    const { artifact } = entry;
    if (
      artifact.kind !== "archive" ||
      artifact.component !== tofuArchiveComponent(stack) ||
      artifact.origin.kind !== "first-party" ||
      Object.keys(artifact.requires).length > 0 ||
      artifact.runtimeDigests.length > 0
    )
      throw new Error(
        `OpenTofu archive for ${stack} must be a first-party archive:tofu-${stack} artifact without dependencies`,
      );
    validateTofuArchiveUri(artifact.uri, stack, artifact.digest);
    if (
      execution !== undefined &&
      (artifact.id !==
        tofuArchiveArtifactId(
          execution.repositoryId,
          execution.pipelineNumber,
          stack,
        ) ||
        artifact.version !== `build-${String(execution.pipelineNumber)}`)
    )
      throw new Error(
        `OpenTofu archive for ${stack} belongs to another CI execution`,
      );
    byStack.set(stack, entry);
  }
  const missing = TofuStackSchema.options.filter(
    (stack) => !byStack.has(stack),
  );
  if (missing.length > 0)
    throw new Error(
      `OpenTofu archive handoff is missing stacks: ${missing.join(", ")}`,
    );
  return TofuStackSchema.options.flatMap((stack) => {
    const entry = byStack.get(stack);
    return entry === undefined ? [] : [entry];
  });
}

/** One pending Delivery build per `tofu-<stack>` service, each owning its stack's exact archive. */
export function attachTofuArchivePublications(
  publications: readonly PublishBuild[],
  artifacts: unknown,
  input: {
    sourceRevision: string;
    ciUrl: string;
    pipelineNumber: number;
    repositoryId: number;
    capturedAt: string;
    catalog?: CatalogCore;
  },
): PublishBuild[] {
  const catalog = input.catalog ?? CATALOG_CORE;
  const entries = parseTofuArchivePublications(artifacts, {
    repositoryId: input.repositoryId,
    pipelineNumber: input.pipelineNumber,
  });
  const builds = entries.map((entry) => {
    if (!catalogOwnsService(entry.serviceId, catalog))
      throw new Error(
        `OpenTofu archive ${entry.artifact.component} requires a service catalog owner ${entry.serviceId}`,
      );
    if (publications.some((build) => build.serviceId === entry.serviceId))
      throw new Error(
        `One CI pipeline cannot publish ${entry.serviceId} twice`,
      );
    return PublishBuildSchema.parse({
      requestId: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/${entry.serviceId}`,
      serviceId: entry.serviceId,
      sourceRevision: input.sourceRevision,
      ciUrl: input.ciUrl,
      verifiedAt: input.capturedAt,
      artifacts: [entry.artifact],
      retainedArtifactIds: [],
    });
  });
  return [...publications, ...builds];
}
