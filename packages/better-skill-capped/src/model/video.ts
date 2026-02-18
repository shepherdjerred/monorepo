import { z } from "zod";
import type { Role } from "./role.ts";
import { isCommentary } from "./commentary.ts";

export type Video = {
  role: Role;
  title: string;
  description: string;
  releaseDate: Date;
  durationInSeconds: number;
  uuid: string;
  imageUrl: string;
  skillCappedUrl: string;
};

const VideoDiscriminantSchema = z.object({ skillCappedUrl: z.unknown() });

export function isVideo(item: unknown): boolean {
  return VideoDiscriminantSchema.safeParse(item).success && !isCommentary(item);
}
