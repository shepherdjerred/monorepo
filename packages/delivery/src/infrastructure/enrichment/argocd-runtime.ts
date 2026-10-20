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

/**
 * Compare the image digests a version set selects with the images ArgoCD
 * reports running. A component ArgoCD reports no image for is not compared.
 */
export function compareLiveImages(
  selected: VersionSetRevision | null,
  images: string[],
): ImageCheck[] {
  if (selected === null) return [];
  return Object.values(selected.components)
    .filter((artifact) => artifact.kind === "image")
    .flatMap((artifact) => {
      const live = images.filter((image) =>
        image.startsWith(`${artifact.uri}@`),
      );
      if (live.length === 0) return [];
      const expected = [artifact.digest, ...artifact.runtimeDigests];
      return {
        component: artifact.component,
        expected: artifact.digest,
        live,
        matches: live.every((image) =>
          expected.some((digest) => image.endsWith(`@${digest}`)),
        ),
      };
    });
}

export async function readArgoRuntime(options: {
  origin: string;
  token: string;
  application: string;
  accepted: VersionSetRevision | null;
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
    imageChecks: compareLiveImages(options.accepted, images),
  };
}
