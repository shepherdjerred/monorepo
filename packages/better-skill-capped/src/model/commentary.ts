import type { Video } from "./video.ts";

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
} & Video;

export function isCommentary(item: unknown): boolean {
  // eslint-disable-next-line custom-rules/prefer-zod-validation -- simple discriminant check for stored bookmark type
  return typeof item === "object" && item !== null && "matchLink" in item;
}
