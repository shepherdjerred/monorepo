import { expect, test } from "vitest";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { retiredWriterExpiry } from "./writer-proof.ts";

const now = 121_000;
const lease = {
  recoveryEpoch: 2,
  configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
  targetsDigest: snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments),
  observedAt: new Date(120_000),
  expiresAt: new Date(180_000),
  revokedAt: null,
};

test("requires a current retired-writer proof that covers Maintainerr", () => {
  expect(retiredWriterExpiry(lease, 2, now)).toBe(180_000);
  const withoutMaintainerr = LEGACY_OBSERVER_CONFIG.legacyDeployments.filter(
    (name) => name !== "media-maintainerr",
  );
  expect(
    retiredWriterExpiry(
      { ...lease, targetsDigest: snapshotHash(withoutMaintainerr) },
      2,
      now,
    ),
  ).toBeNull();
  expect(retiredWriterExpiry(null, 2, now)).toBeNull();
  expect(retiredWriterExpiry(lease, 1, now)).toBeNull();
  expect(
    retiredWriterExpiry({ ...lease, revokedAt: new Date(now) }, 2, now),
  ).toBeNull();
  expect(retiredWriterExpiry(lease, 2, 180_000)).toBeNull();
});
