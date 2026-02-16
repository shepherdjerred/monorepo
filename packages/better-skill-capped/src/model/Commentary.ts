import type { Video } from "./Video";

export type Commentary = {
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
} & Video

export function isCommentary(item: unknown): item is Commentary {
  const possibleCommentary = item as Commentary;
  return "matchLink" in possibleCommentary;
}
