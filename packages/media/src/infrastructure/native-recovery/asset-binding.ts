export function nativeAssetBinding<Subtitles>(
  file: {
    assetId: string;
    assetVersion: number;
    checksum: string;
    mediaIds: string[];
  },
  ownershipEpoch: number,
  subtitles: Subtitles,
) {
  return {
    assetId: file.assetId,
    beforeVersion: file.assetVersion,
    assetVersion: file.assetVersion + 1,
    checksum: file.checksum,
    mediaIds: file.mediaIds,
    ownershipEpoch,
    subtitles,
  };
}
