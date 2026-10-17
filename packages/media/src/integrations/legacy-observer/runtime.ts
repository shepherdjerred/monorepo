import { snapshotHash } from "#migration/profile-import.ts";
import {
  QuiescenceEvidenceSchema,
  type MountBindingRequest,
} from "#shared/legacy-observer.ts";
import { LEGACY_OBSERVER_CONFIG, legacyObserverConfig } from "./config.ts";
import { kubernetesObserverRequest } from "./client.ts";
import { evaluateInventory } from "./evaluate.ts";
import { readInventory } from "./inventory.ts";
import { LegacyObservationError, type ObserverRequest } from "./wire.ts";
import { observeMounts } from "./mounts.ts";

const signalFor = (signal?: AbortSignal) =>
  AbortSignal.any([
    AbortSignal.timeout(LEGACY_OBSERVER_CONFIG.maxDurationMs),
    ...(signal === undefined ? [] : [signal]),
  ]);
export function legacyObserver(
  request: ObserverRequest,
  now: () => number = Date.now,
) {
  return {
    async observe(signal?: AbortSignal) {
      const capturedAt = now();
      const bounded = signalFor(signal);
      const resolved = await legacyObserverConfig.get("topology");
      const config = resolved.value;
      const first = evaluateInventory(await readInventory(request, bounded));
      const second = evaluateInventory(await readInventory(request, bounded));
      if (snapshotHash(first) !== snapshotHash(second))
        throw new LegacyObservationError("inventory_changed");
      return QuiescenceEvidenceSchema.parse({
        ...second,
        schemaVersion: 1,
        namespace: "media",
        capturedAt: new Date(capturedAt).toISOString(),
        expiresAt: new Date(
          capturedAt + config.evidenceLifetimeMs,
        ).toISOString(),
        targetsDigest: snapshotHash(config.legacyDeployments),
        configurationDigest: snapshotHash(config),
      });
    },
    observeMountBindings(
      bindings: MountBindingRequest[],
      signal?: AbortSignal,
    ) {
      return observeMounts({
        request,
        bindings,
        signal: signalFor(signal),
        now,
      });
    },
  };
}

export function createLegacyObserver(
  environment: Record<string, string | undefined>,
) {
  return legacyObserver(kubernetesObserverRequest(environment));
}
