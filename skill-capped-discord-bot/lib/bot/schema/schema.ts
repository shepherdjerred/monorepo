export interface Course {
  uuid: string;
  title: string;
  videos: Video[];
}

export interface Video {
  uuid: string;
  title: string;
  releaseDate: Date;
  url: string;
  thumbnail: string;
}

export type Commentary = Video;

export interface CommonSchema {
  videos: Video[];
  courses: Course[];
  commentaries: Video[];
}

export type LeagueOfLegendsSchema = CommonSchema;
export type WorldOfWarcraftSchema = CommonSchema;
export type ValorantSchema = CommonSchema;
export type Schemas =
  | LeagueOfLegendsSchema
  | WorldOfWarcraftSchema
  | ValorantSchema;
