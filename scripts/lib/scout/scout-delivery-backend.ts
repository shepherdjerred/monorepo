import { z } from "zod";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import type { ArtifactVersion } from "@shepherdjerred/delivery/contract";
import type { ScoutReleaseState } from "./scout-release-state.ts";

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const Source = z.string().regex(/^[a-f0-9]{40}$/u);
const QualifiedScoutImage = ArtifactVersionSchema.extend({
  serviceId: z.literal("scout-for-lol"),
  component: z.literal("image:scout-for-lol"),
  kind: z.literal("image"),
  uri: z.literal("docker.io/shepherdjerred/scout-for-lol"),
});
export const ScoutDeliveryBackendSchema = z.discriminatedUnion("provenance", [
  z
    .object({
      provenance: z.literal("current-build"),
      digest: Digest,
      sourceRevision: Source,
      repositoryId: z.number().int().positive(),
      pipelineNumber: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      provenance: z.literal("qualified-artifact"),
      artifact: QualifiedScoutImage,
    })
    .strict(),
]);

/** Reuse a qualified artifact's identity; never republish a retained image. */
export async function resolveScoutDeliveryBackend(
  input: {
    digests: unknown;
    sourceRevision: string;
    repositoryId: number;
    pipelineNumber: number;
  },
  latest: (query: {
    serviceId: string;
    component: string;
    kind: "image";
  }) => Promise<ArtifactVersion>,
) {
  const digests = z.record(z.string(), Digest).parse(input.digests);
  const fresh = digests["shepherdjerred/scout-for-lol"];
  return ScoutDeliveryBackendSchema.parse(
    fresh === undefined
      ? {
          provenance: "qualified-artifact",
          artifact: await latest({
            serviceId: "scout-for-lol",
            component: "image:scout-for-lol",
            kind: "image",
          }),
        }
      : {
          provenance: "current-build",
          digest: fresh,
          sourceRevision: input.sourceRevision,
          repositoryId: input.repositoryId,
          pipelineNumber: input.pipelineNumber,
        },
  );
}

export function scoutDeliveryBackendDigest(raw: unknown): string {
  const selected = ScoutDeliveryBackendSchema.parse(raw);
  return selected.provenance === "current-build"
    ? selected.digest
    : selected.artifact.digest;
}

export function scoutArchiveRequirements(
  state: ScoutReleaseState,
  rawBackend: unknown,
  currentBuild: {
    sourceRevision: string;
    repositoryId: number;
    pipelineNumber: number;
  },
) {
  const selected = ScoutDeliveryBackendSchema.parse(rawBackend);
  const digest = scoutDeliveryBackendDigest(selected);
  if (
    state.sourceCommit !== Source.parse(currentBuild.sourceRevision) ||
    (selected.provenance === "current-build" &&
      (selected.sourceRevision !== currentBuild.sourceRevision ||
        selected.repositoryId !== currentBuild.repositoryId ||
        selected.pipelineNumber !== currentBuild.pipelineNumber))
  )
    throw new Error(
      "Delivery archive source does not match this producing CI build",
    );
  if (state.backendImageDigest !== digest)
    throw new Error(
      "Delivery archive state differs from its frozen backend artifact",
    );
  return { "image:scout-for-lol": digest };
}
