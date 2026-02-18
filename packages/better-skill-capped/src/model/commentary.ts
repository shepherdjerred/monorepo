import { z } from "zod";
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

const CommentaryDiscriminantSchema = z.object({ matchLink: z.unknown() });

export function isCommentary(item: unknown): boolean {
  return CommentaryDiscriminantSchema.safeParse(item).success;
}
