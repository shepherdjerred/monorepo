export type ParticipantObjectives = {
  readonly turrets: number;
  readonly inhibitors: number;
  readonly barons: number | null;
  readonly dragons: number | null;
};

/**
 * A team's objectives, summed from its players, or `null` when a player's
 * record does not state them: a history record (a game known only from the
 * League client's match history) states no per-player baron or dragon kills.
 */
export function teamObjectives(
  participants: readonly { readonly objectives: ParticipantObjectives }[],
) {
  let totals = { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 };
  for (const { objectives } of participants) {
    if (objectives.barons === null || objectives.dragons === null) return null;
    totals = {
      turrets: totals.turrets + objectives.turrets,
      inhibitors: totals.inhibitors + objectives.inhibitors,
      barons: totals.barons + objectives.barons,
      dragons: totals.dragons + objectives.dragons,
    };
  }
  return totals;
}
