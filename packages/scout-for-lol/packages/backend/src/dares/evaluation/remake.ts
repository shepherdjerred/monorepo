import type { RawMatch } from "@scout-for-lol/data";
export function isRemakeMatch(matchData: RawMatch): boolean {
  return (
    matchData.info.endOfGameResult !== "GameComplete" ||
    matchData.info.participants.some(
      (participant) =>
        participant.gameEndedInEarlySurrender ||
        participant.teamEarlySurrendered,
    )
  );
}
