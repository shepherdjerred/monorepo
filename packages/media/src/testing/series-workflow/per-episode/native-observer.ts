import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import type { createPerEpisodeMultiSeasonFixture } from "./fixture.ts";

/** Fresh disposable platform transport responses. Their mount identities are
 * the same ones the actual initial owner approvals observed; no receipt, actor,
 * runtime, SQL or SDK clock is edited to manufacture prior authority. */
export function perEpisodeNativeObserverV1(
  f: Awaited<ReturnType<typeof createPerEpisodeMultiSeasonFixture>>,
) {
  return {
    ...f.network.context.observer,
    observe: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const current = await f.network.context.observer.observe();
      const capturedAt = Date.now();
      signal?.throwIfAborted();
      return QuiescenceEvidenceSchema.parse({
        ...current,
        capturedAt: new Date(capturedAt).toISOString(),
        expiresAt: new Date(
          capturedAt + LEGACY_OBSERVER_CONFIG.evidenceLifetimeMs,
        ).toISOString(),
      });
    },
    observeCanonicalMounts: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const current = await f.network.context.observer.observeMountBindings(
        ["movies", "tv"].map((kind) => ({
          sourceDeployment: kind === "movies" ? "media-radarr" : "media-sonarr",
          sourceContainer: "container-0",
          sourceRoot: `/${kind}`,
          canonicalDeployment: "media-media-files",
          canonicalContainer: "media-files",
          canonicalRoot: `/data/${kind}`,
        })),
      );
      const capturedAt = Date.now();
      signal?.throwIfAborted();
      return CanonicalMountEvidenceSchema.parse({
        schemaVersion: 1,
        kind: "canonical_storage",
        namespace: "media",
        capturedAt: new Date(capturedAt).toISOString(),
        expiresAt: new Date(
          capturedAt + LEGACY_OBSERVER_CONFIG.evidenceLifetimeMs,
        ).toISOString(),
        configurationDigest: current.configurationDigest,
        mounts: current.bindings.map((binding) => binding.canonical),
      });
    },
  };
}
