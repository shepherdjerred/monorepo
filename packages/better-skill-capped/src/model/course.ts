import { z } from "zod";
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

const CourseDiscriminantSchema = z.object({ videos: z.unknown() });

export function isCourse(item: unknown): boolean {
  return CourseDiscriminantSchema.safeParse(item).success;
}
