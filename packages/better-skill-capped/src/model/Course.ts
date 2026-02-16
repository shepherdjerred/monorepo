import { Role } from "./Role";
import { CourseVideo } from "./CourseVideo";

export interface Course {
  title: string;
  uuid: string;
  description?: string;
  releaseDate: Date;
  role: Role;
  image: string;
  videos: CourseVideo[];
}

export function isCourse(item: unknown): item is Course {
  const possibleCourse = item as Course;
  return "videos" in possibleCourse;
}
