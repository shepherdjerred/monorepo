import path from "node:path";
import type {
  PublicationAssetSnapshot,
  PublicationParticipant,
} from "#shared/publication-proof/intent.ts";

/** Completion grants only the original video's restored canonical participants. */
export function assertCompensationRestoredParticipants(
  asset: PublicationAssetSnapshot,
  participants: readonly PublicationParticipant[],
  libraryKind: "movies" | "tv",
): void {
  const sidecars = asset.subtitles.filter(
    (item) => item.storageKind === "sidecar",
  );
  if (participants.length !== sidecars.length + 1)
    throw new Error("Compensation completion participant set changed");
  const identities = new Set<string>();
  for (const participant of participants) {
    const relative = assertParticipant(asset, participant, libraryKind);
    if (identities.has(relative))
      throw new Error(
        "Compensation completion canonical participant path changed",
      );
    identities.add(relative);
  }
  if (
    participants.filter((item) => item.subtitleId === null).length !== 1 ||
    sidecars.some(
      (subtitle) =>
        participants.filter((item) => item.subtitleId === subtitle.id)
          .length !== 1,
    )
  )
    throw new Error("Compensation completion omitted a restored participant");
}

function assertParticipant(
  asset: PublicationAssetSnapshot,
  participant: PublicationParticipant,
  libraryKind: "movies" | "tv",
) {
  const sidecars = asset.subtitles.filter(
    (item) => item.storageKind === "sidecar",
  );
  const subtitle =
    participant.subtitleId === null
      ? null
      : sidecars.find((item) => item.id === participant.subtitleId);
  const canonical = subtitle === null ? asset.path : subtitle?.path;
  const checksum = subtitle === null ? asset.checksum : subtitle?.checksum;
  const physical = participant.physical;
  if (
    canonical == null ||
    checksum == null ||
    participant.assetId !== asset.id ||
    participant.libraryKind !== libraryKind ||
    physical.root !== "library" ||
    physical.state !== "present" ||
    participant.role !== (subtitle === null ? "video" : "sidecar") ||
    physical.sha256 !== checksum ||
    (subtitle === null && physical.sizeBytes !== asset.sizeBytes)
  )
    throw new Error(
      "Compensation completion physical participant is not an exact restored binding",
    );
  return canonicalParticipantPath(canonical, physical.path, libraryKind);
}

function canonicalParticipantPath(
  canonical: string,
  physicalPath: string,
  libraryKind: "movies" | "tv",
) {
  const relative = path.posix.relative(`/data/${libraryKind}`, canonical);
  if (
    physicalPath !== relative ||
    relative.length === 0 ||
    relative.startsWith("..") ||
    path.posix.isAbsolute(relative)
  )
    throw new Error(
      "Compensation completion canonical participant path changed",
    );
  return relative;
}
