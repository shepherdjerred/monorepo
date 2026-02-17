export interface RawVideo {
  cSS: string;
  desc: string;
  durSec: string;
  rDate: string;
  role: string;
  tId: string;
  tSS: string;
  title: string;
  uuid: string;
}

export type RawCommentary = RawVideo;

export interface RawCourse {
  courseImage: string;
  courseImage2: string;
  desc: string;
  rDate: string;
  role: string;
  title: string;
  uuid: string;
}

export interface RawCommonSchema {
  config: unknown;
  courses: RawCourse[];
  patch: unknown;
  thisWeekData: unknown;
  timeStamp: unknown;
  videos: RawVideo[];
  videosToCourses: RawChapters;
}

export interface RawChapters {
  [key: string]: {
    chapters: [
      {
        title: string;
        vids: [
          {
            uuid: string;
            altTitle?: string;
          },
        ];
      },
    ];
  };
}

export type RawValorantSchema = RawCommonSchema;

export type RawWorldOfWarcraftSchema = RawCommonSchema;

export interface RawLeagueOfLegendsSchema extends RawCommonSchema {
  commentaries: RawCommentary[];
  staff: unknown;
}

export type RawSchemas =
  | RawValorantSchema
  | RawWorldOfWarcraftSchema
  | RawLeagueOfLegendsSchema;
