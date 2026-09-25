/** Longer than the desktop's bounded one-hour request timeout. */
export const REPLAY_UPLOAD_LEASE_MS = 75 * 60 * 1000;

export function replayUploadLeaseCutoff(now: Date): Date {
  return new Date(now.getTime() - REPLAY_UPLOAD_LEASE_MS);
}

export function replayUploadClaimIsStale(updatedAt: Date, now: Date): boolean {
  return updatedAt <= replayUploadLeaseCutoff(now);
}
