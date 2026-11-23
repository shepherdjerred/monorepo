import { NEUTRAL_CREATION_PACKAGE_SHA } from "./latest-neutral-creation.mjs";
import { isApprovedMap11NeutralCharacterRecordsProof } from "./latest-map11-neutral-contract.mjs";

// Separate original745 gameplay inventory: never append a synthetic entity to
// the original generic-spawn worldEntities inventory or restore a snapshot.
export function bindLatestNeutralCorpseEntity(
  report,
  binding,
  characterRecordsProofSha256,
) {
  const sources = report.neutralCreations?.filter(
    (row) => row.entityId === binding.event.entityId,
  );
  const source = sources?.length === 1 ? sources[0] : null;
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    report.neutralCreationPackageSha256 !== NEUTRAL_CREATION_PACKAGE_SHA ||
    !isApprovedMap11NeutralCharacterRecordsProof(characterRecordsProofSha256) ||
    binding.entityClass !== "neutral-minion" ||
    !source ||
    source.kind !== "neutral-creation-candidate" ||
    source.stream !== 1 ||
    source.nativeWorldAcceptance !== false ||
    source.time !== binding.event.time ||
    source.transportSequence !== binding.event.transportSequence
  )
    throw Error(
      "Corpse neutral subject requires its original gameplay inventory and native record proof",
    );
  return {
    entityId: source.entityId,
    entityClass: "neutral-minion",
    creationTime: source.time,
  };
}
