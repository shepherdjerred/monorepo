import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";

type WriterLease = {
  recoveryEpoch: number;
  configurationDigest: string;
  targetsDigest: string;
  observedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export function retiredWriterExpiry(
  lease: WriterLease | null,
  epoch: number,
  now: number,
) {
  return lease?.revokedAt !== null ||
    lease.recoveryEpoch !== epoch ||
    lease.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG) ||
    lease.targetsDigest !==
      snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments) ||
    lease.observedAt.getTime() > now ||
    lease.expiresAt.getTime() <= now ||
    lease.expiresAt.getTime() - lease.observedAt.getTime() > 120_000
    ? null
    : lease.expiresAt.getTime();
}
