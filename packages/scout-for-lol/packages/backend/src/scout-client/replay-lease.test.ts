import { describe, expect, test } from "vitest";
import {
  REPLAY_UPLOAD_LEASE_MS,
  replayUploadClaimIsStale,
  replayUploadLeaseCutoff,
} from "./replay-lease.ts";

const NOW = new Date("2026-09-20T12:00:00.000Z");

describe("replay upload lease", () => {
  test("reclaims a claim at the lease boundary", () => {
    const cutoff = replayUploadLeaseCutoff(NOW);
    expect(replayUploadClaimIsStale(cutoff, NOW)).toBe(true);
    expect(replayUploadClaimIsStale(new Date(cutoff.getTime() + 1), NOW)).toBe(
      false,
    );
    expect(NOW.getTime() - cutoff.getTime()).toBe(REPLAY_UPLOAD_LEASE_MS);
  });
});
