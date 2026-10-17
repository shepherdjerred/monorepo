import {
  CanonicalMountEvidenceSchema,
  CanonicalMountSchema,
} from "#shared/canonical-storage.ts";
import { LEGACY_OBSERVER_CONFIG } from "./config.ts";
import { readInventory } from "./inventory.ts";
import { inspectMount } from "./mounts.ts";
import {
  observerDigest,
  LegacyObservationError,
  type ObserverRequest,
} from "./wire.ts";

async function readCanonical(request: ObserverRequest, signal: AbortSignal) {
  const inventory = await readInventory(request, signal);
  const mounts = [];
  for (const root of ["/data/movies", "/data/tv"]) {
    mounts.push(
      CanonicalMountSchema.parse(
        await inspectMount(
          request,
          {
            deployment: "media-media-files",
            container: "media-files",
            root,
            inventory,
          },
          signal,
        ),
      ),
    );
  }
  return mounts;
}

/** Canonical storage is read from the actual ready Pod; no legacy source alias is invented. */
export async function observeCanonicalMounts(input: {
  request: ObserverRequest;
  signal: AbortSignal;
  now: () => number;
}): Promise<ReturnType<typeof CanonicalMountEvidenceSchema.parse>> {
  const capturedAt = input.now();
  const first = await readCanonical(input.request, input.signal);
  const second = await readCanonical(input.request, input.signal);
  if (observerDigest(first) !== observerDigest(second))
    throw new LegacyObservationError("canonical_mount_inventory_changed");
  return CanonicalMountEvidenceSchema.parse({
    schemaVersion: 1,
    kind: "canonical_storage",
    namespace: "media",
    capturedAt: new Date(capturedAt).toISOString(),
    expiresAt: new Date(
      capturedAt + LEGACY_OBSERVER_CONFIG.evidenceLifetimeMs,
    ).toISOString(),
    configurationDigest: observerDigest(LEGACY_OBSERVER_CONFIG),
    mounts: second,
  });
}
