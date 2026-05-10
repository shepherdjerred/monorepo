import { z } from "zod";

const RoleSchema = z.enum(["all", "mid", "adc", "jungle", "top", "support"]);

const LaneRoleSchema = RoleSchema.exclude(["all"]);

const ManifestPatchSchema = z
  .object({
    patchVal: z.string(),
    releaseDate: z.number().int().positive(),
    patchUrl: z.url(),
  })
  .strict();

const ManifestVideoSchema = z
  .object({
    role: RoleSchema,
    title: z.string(),
    desc: z.string(),
    rDate: z.number().int().positive(),
    durSec: z.number().int().positive(),
    uuid: z.string().min(1),
    tId: z.number().int().nonnegative(),
    tSS: z.union([z.literal(""), z.url()]),
    cSS: z.string(),
  })
  .strict();

const ManifestCommentarySchema = z
  .object({
    role: LaneRoleSchema,
    title: z.string().optional(),
    desc: z.string().optional(),
    rDate: z.number().int().positive(),
    durSec: z.number().int().positive(),
    uuid: z.string().min(1),
    tId: z.number().int().nonnegative(),
    tSS: z.string(),
    staff: z.string().min(1),
    matchLink: z.string(),
    yourChampion: z.string().min(1),
    theirChampion: z.string().min(1),
    k: z.coerce.number().int().nonnegative(),
    d: z.coerce.number().int().nonnegative(),
    a: z.coerce.number().int().nonnegative(),
    gameTime: z.string(),
    carry: z.enum(["Light", "Medium", "Heavy"]),
    type: z.enum(["Smurf", "High Elo", "Earpiece"]),
    rune1: z.string(),
    rune2: z.string(),
    rune3: z.string(),
    item1: z.union([z.literal(""), z.number().int().positive()]),
    item2: z.union([z.literal(""), z.number().int().positive()]),
    item3: z.union([z.literal(""), z.number().int().positive()]),
  })
  .strict();

const ManifestStaffSchema = z
  .object({
    name: z.string().min(1),
    summonerName: z.string().min(1),
    profileImage: z.url(),
    profileImageWithRank: z.url(),
    playerPeakRank: z.union([z.number().int().positive(), z.string()]),
  })
  .strict();

const ManifestCourseSchema = z
  .object({
    title: z.string().min(1),
    uuid: z.string().min(1),
    desc: z.string(),
    rDate: z.number().int().positive(),
    role: RoleSchema,
    courseImage: z.url(),
    courseImage2: z.url(),
    courseImage3: z.url(),
    tags: z.array(z.string()),
    recommended: z.boolean(),
    override: z.boolean(),
    overlay: z.string(),
    groupingKey: z.string().optional(),
    marketingString: z.string().optional(),
    seasonString: z.string().optional(),
  })
  .strict();

const ManifestThisWeekDataSchema = z
  .object({
    year: z.number().int().positive(),
    weekNum: z.number().int().positive(),
    release: z.number().int().positive(),
    role: RoleSchema,
    type: z.string(),
    vidTitle: z.string(),
    order: z.number().int().nonnegative(),
    courseName: z.string(),
  })
  .strict();

const ManifestConfigSchema = z
  .object({
    game: z.literal("lol"),
    tcoaching: z.string(),
    "": z.string(),
  })
  .strict();

const ManifestCarouselEntrySchema = z
  .object({
    courseTitle: z.string().nullable(),
    image: z.url(),
    page: z.number().int().positive(),
    size: z.string(),
    videoTitle: z.string().nullable(),
    url: z.url().nullable(),
  })
  .strict();

const ManifestTagInfoSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

const ManifestCourseChapterEntrySchema = z
  .object({
    chapters: z.tuple([
      z
        .object({
          title: z.string().min(1),
          vids: z.array(
            z
              .object({
                uuid: z.string().min(1),
                altTitle: z.string().optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ]),
  })
  .strict();

const ManifestCourseChaptersSchema = z.record(
  z.string(),
  ManifestCourseChapterEntrySchema.optional(),
);

export const ManifestSchema = z
  .object({
    timeStamp: z.number().int().positive(),
    patch: ManifestPatchSchema,
    config: ManifestConfigSchema,
    videos: z.array(ManifestVideoSchema),
    commentaries: z.array(ManifestCommentarySchema),
    staff: z.array(ManifestStaffSchema),
    courses: z.array(ManifestCourseSchema),
    thisWeekData: z.union([
      z.array(ManifestThisWeekDataSchema),
      ManifestThisWeekDataSchema,
    ]),
    carousel: z.array(ManifestCarouselEntrySchema),
    tagInfo: z.array(ManifestTagInfoSchema),
    videosToCourses: ManifestCourseChaptersSchema,
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestPatch = z.infer<typeof ManifestPatchSchema>;
export type ManifestVideo = z.infer<typeof ManifestVideoSchema>;
export type ManifestCommentary = z.infer<typeof ManifestCommentarySchema>;
export type ManifestStaff = z.infer<typeof ManifestStaffSchema>;
export type ManifestCourse = z.infer<typeof ManifestCourseSchema>;
export type ManifestThisWeekData = z.infer<typeof ManifestThisWeekDataSchema>;
export type ManifestCourseChapters = z.infer<
  typeof ManifestCourseChaptersSchema
>;
