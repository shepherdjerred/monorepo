/** The old validator could reject valid ROFLs while reading the compression header. */
export const legacyCompressionRejection = {
  uploadState: "REJECTED",
  lastError: "Replay chunk compression is invalid",
} as const;

export function isLegacyCompressionRejection(artifact: {
  readonly uploadState: string;
  readonly lastError: string | null;
}): boolean {
  return (
    artifact.uploadState === legacyCompressionRejection.uploadState &&
    artifact.lastError === legacyCompressionRejection.lastError
  );
}
