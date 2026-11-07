import type { z } from "zod";
import type { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";

/** Shared clock-only check. It has no Files, receipt or authority dependencies. */
export function assertNativeEvidenceFresh(
  network: Pick<
    z.infer<typeof NativeRecoveryNetworkEvidenceSchema>,
    "capturedAt" | "expiresAt" | "quiescence" | "mounts"
  >,
): void {
  const now = Date.now();
  for (const evidence of [network, network.quiescence, network.mounts]) {
    const captured = Date.parse(evidence.capturedAt);
    const expires = Date.parse(evidence.expiresAt);
    if (
      captured > now ||
      expires <= now ||
      expires <= captured ||
      expires - captured > 120_000
    )
      throw new Error(
        "Native recovery authority expired or has invalid freshness",
      );
  }
}
