import {
  getCachedArenaAugmentById,
  type MatchLakeRow,
  type RawParticipant,
} from "@scout-for-lol/data";

type AugmentLakeFields = Pick<
  MatchLakeRow,
  | "augment_1_id"
  | "augment_2_id"
  | "augment_3_id"
  | "augment_4_id"
  | "augment_5_id"
  | "augment_6_id"
>;

function recordedAugment(id: number | undefined): number | null {
  return id === undefined || id === 0 ? null : id;
}

export class UnknownArenaAugmentError extends Error {
  constructor(id: number) {
    super(
      `Arena augment ${id.toString()} is missing from the pinned asset cache`,
    );
    this.name = "UnknownArenaAugmentError";
  }
}

export function participantAugmentLakeFields(
  participant: RawParticipant,
): AugmentLakeFields {
  return {
    augment_1_id: recordedAugment(participant.playerAugment1),
    augment_2_id: recordedAugment(participant.playerAugment2),
    augment_3_id: recordedAugment(participant.playerAugment3),
    augment_4_id: recordedAugment(participant.playerAugment4),
    augment_5_id: recordedAugment(participant.playerAugment5),
    augment_6_id: recordedAugment(participant.playerAugment6),
  };
}

export function arenaAugmentsFromLakeRow(row: AugmentLakeFields) {
  return [
    row.augment_1_id,
    row.augment_2_id,
    row.augment_3_id,
    row.augment_4_id,
    row.augment_5_id,
    row.augment_6_id,
  ]
    .filter((id) => id !== null)
    .map((id) => {
      const augment = getCachedArenaAugmentById(id);
      if (augment === undefined) throw new UnknownArenaAugmentError(id);
      return { id, name: augment.name };
    });
}
