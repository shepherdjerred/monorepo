import { Video } from "./Video";

export interface Commentary extends Video {
  staff: string;
  matchLink: string;
  champion: string;
  opponent: string;
  kills: number;
  deaths: number;
  assists: number;
  gameLengthInMinutes: number;
  carry: string;
  type: string;
}

export function isCommentary(item: unknown): item is Commentary {
  const possibleCommentary = item as Commentary;
  return "matchLink" in possibleCommentary;
}
