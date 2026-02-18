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

export function isCourse(item: unknown): item is Course {
  const possibleCourse = item as Course;
  return "videos" in possibleCourse;
}
