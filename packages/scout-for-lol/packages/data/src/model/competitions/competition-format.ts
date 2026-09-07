import { match } from "ts-pattern";
import type {
  CompetitionGameVariant,
  CompetitionQueueType,
  CompetitionVisibility,
  ParticipantStatus,
} from "#src/model/competitions/competition.ts";

export function competitionQueueTypeToString(
  queueType: CompetitionQueueType,
): string {
  return match(queueType)
    .with("ALL", () => "All queues")
    .with("solo", () => "Ranked Solo/Duo")
    .with("flex", () => "Ranked Flex")
    .with("ranked 5s", () => "Ranked 5s")
    .with("clash", () => "Clash")
    .with("aram clash", () => "ARAM Clash")
    .with("aram", () => "ARAM")
    .with("arurf", () => "ARURF")
    .with("urf", () => "URF")
    .with("quickplay", () => "Quickplay")
    .with("swiftplay", () => "Swiftplay")
    .with("arena", () => "Arena")
    .with("brawl", () => "Brawl")
    .with("aram mayhem", () => "ARAM Mayhem")
    .with("normal", () => "Normal")
    .with("draft pick", () => "Draft Pick")
    .with("easy doom bots", () => "Easy Doom Bots")
    .with("normal doom bots", () => "Normal Doom Bots")
    .with("hard doom bots", () => "Hard Doom Bots")
    .with("custom", () => "Custom")
    .with("classic", () => "League Classic")
    .with("classic aram mayhem", () => "Classic ARAM Mayhem")
    .exhaustive();
}

export function competitionQueuesToString(
  queues: readonly CompetitionQueueType[],
): string {
  return queues.map((queue) => competitionQueueTypeToString(queue)).join(", ");
}

export function competitionGameVariantToString(
  gameVariant: CompetitionGameVariant,
): string {
  return gameVariant === "MODERN" ? "Modern League" : "League Classic";
}

export function visibilityToString(visibility: CompetitionVisibility): string {
  return match(visibility)
    .with("OPEN", () => "Open to All")
    .with("INVITE_ONLY", () => "Invite Only")
    .with("SERVER_WIDE", () => "Server-Wide")
    .exhaustive();
}

export function visibilityDescription(
  visibility: CompetitionVisibility,
): string {
  return match(visibility)
    .with("OPEN", () => "Anyone in the server can join themselves (opt-in).")
    .with("INVITE_ONLY", () => "Players join only when invited.")
    .with(
      "SERVER_WIDE",
      () => "Every tracked player is entered automatically (opt-out).",
    )
    .exhaustive();
}

export function participantStatusToString(status: ParticipantStatus): string {
  return match(status)
    .with("INVITED", () => "Invited")
    .with("JOINED", () => "Joined")
    .with("LEFT", () => "Left")
    .exhaustive();
}
