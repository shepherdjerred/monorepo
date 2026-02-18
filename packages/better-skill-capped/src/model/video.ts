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

export function isVideo(item: unknown): boolean {
  // eslint-disable-next-line custom-rules/prefer-zod-validation -- simple discriminant check for stored bookmark type
  return typeof item === "object" && item !== null && "skillCappedUrl" in item && !isCommentary(item);
}
