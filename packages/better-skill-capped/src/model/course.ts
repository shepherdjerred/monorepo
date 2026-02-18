import type { Role } from "./role.ts";
import type { CourseVideo } from "./course-video.ts";

export type Course = {
  title: string;
  uuid: string;
  description?: string;
  releaseDate: Date;
  role: Role;
  image: string;
  videos: CourseVideo[];
};

export function isCourse(item: unknown): boolean {
  // eslint-disable-next-line custom-rules/prefer-zod-validation -- simple discriminant check for stored bookmark type
  return typeof item === "object" && item !== null && "videos" in item;
}
