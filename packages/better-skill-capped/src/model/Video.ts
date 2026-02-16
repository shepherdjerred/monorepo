import { Role } from "./Role";
import { isCommentary } from "./Commentary";

export interface Video {
  role: Role;
  title: string;
  description: string;
  releaseDate: Date;
  durationInSeconds: number;
  uuid: string;
  imageUrl: string;
  skillCappedUrl: string;
}

export function isVideo(item: unknown): item is Video {
  const possibleVideo = item as Video;
  return "skillCappedUrl" in possibleVideo && !isCommentary(item);
}
