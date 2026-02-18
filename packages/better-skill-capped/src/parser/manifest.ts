import { z } from "zod";

const ManifestPatchSchema = z.object({
  patchVal: z.string(),
  releaseDate: z.number(),
  patchUrl: z.string(),
});

const ManifestVideoSchema = z.object({
  role: z.string(),
  title: z.string(),
  desc: z.string(),
  rDate: z.number(),
  durSec: z.number(),
  uuid: z.string(),
  tId: z.number(),
  tSS: z.string(),
  cSS: z.string(),
});

const ManifestCommentarySchema = z.object({
  role: z.string(),
  title: z.string().optional(),
  desc: z.string(),
  rDate: z.number(),
  durSec: z.number(),
  uuid: z.string(),
  tId: z.number(),
  tSS: z.string(),
  staff: z.string(),
  matchLink: z.string(),
  yourChampion: z.string(),
  theirChampion: z.string(),
  k: z.number(),
  d: z.number(),
  a: z.number(),
  gameTime: z.string(),
  carry: z.string(),
  type: z.string(),
});

const ManifestStaffSchema = z.object({
  name: z.string(),
  summonerName: z.string(),
  profileImage: z.string(),
  profileImageWithRank: z.string(),
});

const ManifestCourseSchema = z.object({
  title: z.string(),
  uuid: z.string(),
  desc: z.string(),
  rDate: z.number(),
  role: z.string(),
  courseImage: z.string(),
  courseImage2: z.string(),
});

const ManifestThisWeekDataSchema = z.object({
  year: z.number(),
  weekNum: z.number(),
  release: z.number(),
  role: z.string(),
  type: z.string(),
  vidTitle: z.string(),
  order: z.number(),
  courseName: z.string(),
});

const ManifestCourseChapterEntrySchema = z.object({
  chapters: z.tuple([
    z.object({
      title: z.string(),
      vids: z.array(z.object({
        uuid: z.string(),
        altTitle: z.string().optional(),
      })),
    }),
  ]),
});

const ManifestCourseChaptersSchema = z.record(
  z.string(),
  ManifestCourseChapterEntrySchema.optional(),
);

export const ManifestSchema = z.object({
  timestamp: z.number(),
  patch: ManifestPatchSchema,
  videos: z.array(ManifestVideoSchema),
  commentaries: z.array(ManifestCommentarySchema),
  staff: z.array(ManifestStaffSchema),
  courses: z.array(ManifestCourseSchema),
  thisWeekData: ManifestThisWeekDataSchema,
  videosToCourses: ManifestCourseChaptersSchema,
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestPatch = z.infer<typeof ManifestPatchSchema>;
export type ManifestVideo = z.infer<typeof ManifestVideoSchema>;
export type ManifestCommentary = z.infer<typeof ManifestCommentarySchema>;
export type ManifestStaff = z.infer<typeof ManifestStaffSchema>;
export type ManifestCourse = z.infer<typeof ManifestCourseSchema>;
export type ManifestThisWeekData = z.infer<typeof ManifestThisWeekDataSchema>;
export type ManifestCourseChapters = z.infer<typeof ManifestCourseChaptersSchema>;
