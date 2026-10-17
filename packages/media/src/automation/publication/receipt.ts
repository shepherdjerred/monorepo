type Receipt = {
  mediaIds: string[];
  assets: { assetId: string; assetVersion: number; checksum: string }[];
};

export function publicationMatchesReceipt(
  coverages: {
    assetId: string;
    asset: { version: number; checksum: string | null };
  }[],
  receipt: Receipt | undefined,
): boolean {
  return (
    receipt === undefined ||
    (coverages.length === receipt.mediaIds.length &&
      coverages.every((coverage) =>
        receipt.assets.some(
          (asset) =>
            asset.assetId === coverage.assetId &&
            asset.assetVersion === coverage.asset.version &&
            asset.checksum === coverage.asset.checksum,
        ),
      ))
  );
}
