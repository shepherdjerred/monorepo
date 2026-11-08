export type SubtitleQuality = {
  assetId: string;
  language: string;
  state: string;
  qualityStatus: string;
  storageKind: string;
  ownershipEpoch: number;
  videoChecksum: string | null;
  videoVersion: number | null;
  checksum: string | null;
  forced: boolean | null;
  hearingImpaired: boolean | null;
  streamIndex: number | null;
  codec: string | null;
};
export type SubtitleVideo = {
  id: string;
  checksum: string | null;
  version: number;
  owned: boolean;
  ownershipEpoch: number;
  state: string;
};
export type SubtitleTarget = {
  language: string;
  forced?: boolean;
  hearingImpaired?: "required" | "excluded" | "any";
};

/** Quality acceptance never follows from filesystem ownership or an installed label. */
export function subtitleAccepted(input: {
  subtitle: SubtitleQuality;
  asset: SubtitleVideo;
  epoch: number;
  target?: SubtitleTarget;
  allowStaged?: boolean;
}): boolean {
  const { subtitle, asset, epoch, target } = input;
  const invalid =
    subtitle.qualityStatus !== "accepted" ||
    subtitle.ownershipEpoch !== epoch ||
    !asset.owned ||
    asset.ownershipEpoch !== epoch ||
    asset.state !== "published" ||
    subtitle.assetId !== asset.id ||
    asset.checksum === null ||
    subtitle.videoChecksum !== asset.checksum ||
    subtitle.videoVersion !== asset.version ||
    !(
      subtitle.state === "installed" ||
      (input.allowStaged === true && subtitle.state === "validated")
    );
  return (
    !invalid &&
    storageKnown(subtitle) &&
    (target === undefined || targetMatches(subtitle, target))
  );
}

function storageKnown(subtitle: SubtitleQuality): boolean {
  return subtitle.storageKind === "sidecar"
    ? subtitle.checksum !== null
    : subtitle.storageKind === "embedded" &&
        subtitle.streamIndex !== null &&
        subtitle.codec !== null;
}
function targetMatches(
  subtitle: SubtitleQuality,
  target: SubtitleTarget,
): boolean {
  return (
    subtitle.language === target.language &&
    (target.forced === undefined || subtitle.forced === target.forced) &&
    (target.hearingImpaired !== "required" ||
      subtitle.hearingImpaired === true) &&
    (target.hearingImpaired !== "excluded" ||
      subtitle.hearingImpaired === false)
  );
}
