import type { CompetitionQueueType, QueueType } from "@scout-for-lol/data";

export function competitionQueueToStoredQueues(
  queue: CompetitionQueueType,
): QueueType[] | undefined {
  switch (queue) {
    case "SOLO":
      return ["solo"];
    case "FLEX":
      return ["flex"];
    case "RANKED_ANY":
      return ["solo", "flex"];
    case "ARENA":
      return ["arena"];
    case "ARAM":
      return ["aram"];
    case "URF":
      return ["urf"];
    case "ARURF":
      return ["arurf"];
    case "QUICKPLAY":
      return ["quickplay"];
    case "SWIFTPLAY":
      return ["swiftplay"];
    case "BRAWL":
      return ["brawl"];
    case "DRAFT_PICK":
      return ["draft pick"];
    case "CUSTOM":
      return ["custom"];
    case "ALL":
      return undefined;
  }
}
