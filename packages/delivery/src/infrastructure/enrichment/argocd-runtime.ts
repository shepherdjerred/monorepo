import { z } from "zod";
import { fetchJson, bearer } from "@shepherdjerred/ops-clients/http.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type {
  ArgoRuntime,
  ImageCheck,
} from "#shared/hub/integration-contract.ts";
import type { VersionSetRevision } from "#shared/contract.ts";

const ArgoApplicationSchema = z.object({
  status: z.object({
    sync: z
      .object({ status: z.string(), revision: z.string().optional() })
      .optional(),
    health: z.object({ status: z.string() }).optional(),
    reconciledAt: z.iso.datetime({ offset: true }).optional(),
    operationState: z
      .object({
        phase: z.string(),
        message: z.string().optional(),
        finishedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .optional(),
    summary: z.object({ images: z.array(z.string()).optional() }).optional(),
  }),
});

const iso = (value: string | undefined) =>
  value === undefined ? null : new Date(value).toISOString();

/** An artifact a worker pool keeps running beside the accepted one. */
export type RetainedImage = {
  uri: string;
  digest: string;
  runtimeDigests: string[];
};

const runs = (image: string, digests: string[]) =>
  digests.some((digest) => image.endsWith(`@${digest}`));

/**
 * Compare the image digests a version set selects with the images ArgoCD
 * reports running. A component ArgoCD reports no image for is not compared.
 *
 * A worker pool runs older builds beside the accepted one until each is
 * retired, so a live image matches when the accepted artifact or a retained
 * worker artifact explains it. The accepted artifact itself must be running.
 *
 * When the environment desires another release than it accepts, such as one
 * whose sync recovery read back as applied though Delivery never accepted
 * it, a live image of that release's artifact is the desired one, counted
 * apart and never unexpected.
 */
export function compareLiveImages(
  selected: VersionSetRevision | null,
  images: string[],
  retained: RetainedImage[],
  desiredSet: VersionSetRevision | null = null,
): ImageCheck[] {
  if (selected === null) return [];
  const desiredRelease =
    desiredSet === null || desiredSet.id === selected.id ? null : desiredSet;
  return Object.values(selected.components)
    .filter((artifact) => artifact.kind === "image")
    .flatMap((artifact) => {
      const live = images.filter((image) =>
        image.startsWith(`${artifact.uri}@`),
      );
      if (live.length === 0) return [];
      const accepted = [artifact.digest, ...artifact.runtimeDigests];
      const kept = retained.flatMap((worker) =>
        worker.uri === artifact.uri
          ? [worker.digest, ...worker.runtimeDigests]
          : [],
      );
      const wanted = desiredRelease?.components[artifact.component];
      const desiredDigests =
        wanted?.kind === "image" && wanted.uri === artifact.uri
          ? [wanted.digest, ...wanted.runtimeDigests]
          : [];
      const others = live.filter((image) => !runs(image, accepted));
      const desired = others.filter((image) => runs(image, desiredDigests));
      const rest = others.filter((image) => !runs(image, desiredDigests));
      const unexpected = rest.filter((image) => !runs(image, kept));
      return {
        component: artifact.component,
        expected: artifact.digest,
        live,
        retained: rest.length - unexpected.length,
        unexpected,
        matches:
          live.some((image) => runs(image, accepted)) &&
          unexpected.length === 0,
        ...(desiredRelease === null
          ? {}
          : {
              desiredRevision: desiredRelease.revision,
              desired: desired.length,
            }),
      };
    });
}

export async function readArgoRuntime(options: {
  origin: string;
  token: string;
  application: string;
  accepted: VersionSetRevision | null;
  /** The release the environment desires, when it is not the accepted one. */
  desired?: VersionSetRevision | null;
  retained: RetainedImage[];
  fetch: Fetch;
}): Promise<ArgoRuntime> {
  const application = await fetchJson(
    options.fetch,
    {
      upstream: "argocd",
      url: new URL(
        `/api/v1/applications/${encodeURIComponent(options.application)}`,
        options.origin,
      ),
      init: {
        headers: { accept: "application/json", ...bearer(options.token) },
      },
      timeoutMs: 5000,
    },
    ArgoApplicationSchema,
  );
  const status = application.status;
  const images = status.summary?.images ?? [];
  return {
    application: options.application,
    syncStatus: status.sync?.status ?? "Unknown",
    syncRevision: status.sync?.revision ?? null,
    healthStatus: status.health?.status ?? "Unknown",
    operationPhase: status.operationState?.phase ?? null,
    operationMessage: status.operationState?.message ?? null,
    operationFinishedAt: iso(status.operationState?.finishedAt),
    reconciledAt: iso(status.reconciledAt),
    images,
    imageChecks: compareLiveImages(
      options.accepted,
      images,
      options.retained,
      options.desired ?? null,
    ),
  };
}
